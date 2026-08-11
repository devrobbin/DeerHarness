from __future__ import annotations
from auth import User, require_admin, require_developer
"""Fusion Bridge：PenguinHarness 造 Agent → DeerFlow 运行时执行。

这才是真正的"融合"，而非门户聚合：
- PenguinHarness 负责 **Agent 定义**（system prompt / 描述，经 /config 端点拉取）
- DeerFlow 提供 **执行运行时**（沙箱 / 记忆 / 子代理 / 搜索 / 技能）
- 流程：读取 penguin Agent 定义 → 同步为 DeerFlow Custom Agent（soul）
  → 对话时以该 assistant 身份在 DeerFlow 中运行（assistant_id）

多 Agent 编排（团队模式）：
- 每个 penguin Agent 注册为 DeerFlow 的 custom_agents 子代理（subagents.custom_agents）
- 主代理（lead agent）通过 task 工具按名动态分派子任务（可并行），汇总结果
"""


import asyncio
import hashlib
import json
import os
import re
import subprocess
import threading
import time
import uuid
from typing import Optional

import httpx
import yaml as _yaml
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import config
from deerflow_client import DeerFlowClient, DeerFlowError
from penguin_client import PenguinClient
from validate import valid_id
import evolution_store
from .traces import record_trace


router = APIRouter()
penguin = PenguinClient()
deerflow = DeerFlowClient()

DEFAULT_MODEL = "deepseek-v4-flash"
POLL_INTERVAL = 2.0
POLL_TIMEOUT = 300.0

# deer-flow 运行配置（宿主机路径，与 docker-compose 挂载一致）
DEERFLOW_CONFIG = config.DEERFLOW_CONFIG
DEERFLOW_COMPOSE_DIR = config.DEERFLOW_COMPOSE_DIR

# 子代理配置写锁 + 上次写入指纹（hash 比对，避免每次请求重写/重启）
_config_lock = threading.Lock()
_last_config_hash: Optional[str] = None
_last_restart_at: Optional[float] = None
_RESTART_DEDUP_S = 120.0  # 并发重启去重窗口（评审 P1-4）

# penguin prompt 同步时的净化包装（来源声明 + 环境失配提示 + 截断上限）
_PROMPT_WRAPPER = (
    "以下职责说明由 PenguinHarness Agent 同步而来（DeerHarness Fusion Bridge）。\n"
    "其中提及的 penguin 专属环境指令（如 CLI、特定目录、scratchpad 等）在本运行时"
    "可能不适用，请忽略与当前环境不符的指令，专注于职责本身。\n\n"
)
_MAX_PROMPT_CHARS = 8000

# penguin builtin 工具 → deer-flow 工具白名单映射（评审遗留：修复 tools:null 能力放大）
_PENGUIN_TOOL_MAP = {
    "read_file": "read_file",
    "write_file": "write_file",
    "str_replace": "str_replace",
    "list_dir": "ls",
    "ls": "ls",
    "glob": "glob",
    "grep": "grep",
    "web_search": "web_search",
    "code_exec": "bash",
    "shell": "bash",
    "run_shell": "bash",
}
# penguin 无工具声明时的保守白名单（只读 + 搜索，不含 bash 执行）
_DEFAULT_TOOL_WHITELIST = ["web_search", "read_file", "write_file", "glob", "grep"]

# 内置评测集：纯文本任务，无需前置文件（example-benchmark 需要 workspace 文件）
_BUILTIN_BENCHMARKS: dict[str, list[dict]] = {
    "dh-benchmark": [
        {
            "id": "DH-001-summary",
            "title": "信息摘要",
            "statement": (
                "请用不超过 3 句话总结下面这段文字的核心内容：\n"
                "「DeerHarness 是一个融合 PenguinHarness 与 DeerFlow 的 AI Agent 平台。"
                "PenguinHarness 负责低成本构建和自进化 Agent，DeerFlow 提供长链路多智能体"
                "执行运行时。平台通过统一网关管理 Agent、进化、轨迹与成本。」"
            ),
        },
        {
            "id": "DH-002-format",
            "title": "Markdown 格式遵循",
            "statement": (
                "请输出一个 Markdown 二级标题「核心要点」，下面跟 3 个无序列表项，"
                "每项一句话。不要输出其他内容。"
            ),
        },
        {
            "id": "DH-003-json",
            "title": "结构化 JSON 输出",
            "statement": (
                "以 JSON 格式输出一个包含 name、version、tools 三个字段的对象，"
                "其中 tools 是字符串数组（至少 2 项）。只输出 JSON，不要额外文字。"
            ),
        },
        {
            "id": "AMZ-001-listing",
            "title": "Amazon Listing 五点描述",
            "statement": (
                "为「便携式电动奶泡器（USB 充电，304 不锈钢）」写 Amazon Listing 的"
                "五点描述（Bullet Points），共 5 条，每条不超过 200 字符，"
                "突出卖点与使用场景，英文输出。"
            ),
        },
        {
            "id": "TT-001-sourcing",
            "title": "TikTok Shop 选品标准",
            "statement": (
                "给出 TikTok Shop 美区选品的 5 条核心标准（含内容适配度维度），"
                "并基于标准判断：便携奶泡器是否适合作为 TikTok Shop 爆品？"
                "用 Markdown 输出，结论明确。"
            ),
        },
    ],
}


def _map_penguin_tools(tool_names: list[str]) -> list[str]:
    """penguin 工具名 → deer-flow 工具白名单（去重、保持顺序、跳过未知）。"""
    mapped: list[str] = []
    seen: set[str] = set()
    for name in tool_names:
        target = _PENGUIN_TOOL_MAP.get(name)
        if target and target not in seen:
            seen.add(target)
            mapped.append(target)
    return mapped or list(_DEFAULT_TOOL_WHITELIST)


class FusionChatRequest(BaseModel):
    agent_id: str
    message: str
    project_id: Optional[str] = None
    thread_id: Optional[str] = None  # 多轮会话复用（评审 B）


class FusionSyncRequest(BaseModel):
    agent_id: str
    project_id: Optional[str] = None


def _deerflow_agent_name(agent_id: str) -> str:
    """penguin agent id → deer-flow custom agent 名（dh- 前缀防冲突）。"""
    return "dh-" + re.sub(r"[^A-Za-z0-9-]", "-", agent_id).lower()


async def _proxy_df(method: str, path: str, **kwargs) -> dict:
    try:
        resp = await deerflow.request(method, path, **kwargs)
    except DeerFlowError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


async def _get_penguin_agent_def(agent_id: str, project_id: str) -> dict:
    """拉取 penguin Agent 定义（systemConfigYaml → system_prompt）。"""
    try:
        resp = await penguin.request(
            "GET", f"/api/projects/{project_id}/agents/{agent_id}/config"
        )
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="PenguinHarness 服务不可达")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    prompt = ""
    tools: list[str] = []
    yaml_text = data.get("systemConfigYaml") or ""
    if yaml_text:
        try:
            cfg = _yaml.safe_load(yaml_text) or {}
            prompt = str(cfg.get("system_prompt") or "")
            builtin = ((cfg.get("tools") or {}).get("builtin") or [])
            tools = _map_penguin_tools(
                [t.get("name", "") for t in builtin if isinstance(t, dict)]
            )
        except Exception:
            pass
    # 净化：包装来源声明 + 环境失配提示 + 截断上限（评审 P1-3）
    prompt = prompt[:_MAX_PROMPT_CHARS]
    if prompt:
        prompt = _PROMPT_WRAPPER + prompt
    return {"system_prompt": prompt, "tools": tools}


async def _sync_agent(agent_id: str, project_id: str) -> str:
    """同步 penguin Agent → DeerFlow Custom Agent（幂等），返回 deer-flow 名。"""
    name = _deerflow_agent_name(agent_id)
    definition = await _get_penguin_agent_def(agent_id, project_id)
    soul = definition["system_prompt"] or f"你是 PenguinHarness 同步的 Agent：{agent_id}。"

    agents = await _proxy_df("GET", "/api/agents")
    exists = any(a.get("name") == name for a in agents.get("agents", []))
    if exists:
        await _proxy_df("PUT", f"/api/agents/{name}", json={"soul": soul})
    else:
        await _proxy_df(
            "POST",
            "/api/agents",
            json={
                "name": name,
                "description": f"由 PenguinHarness Agent [{agent_id}] 同步（DeerHarness Fusion Bridge）",
                "model": DEFAULT_MODEL,
                "soul": soul,
            },
        )
    return name


@router.post("/sync")
async def fusion_sync(req: FusionSyncRequest, user: User = Depends(require_admin)):
    """同步单个 penguin Agent 到 DeerFlow（幂等）。"""
    req.agent_id = valid_id(req.agent_id, "agent_id")
    project_id = valid_id(req.project_id or "default_project", "project_id")
    name = await _sync_agent(req.agent_id, project_id)
    return {"success": True, "agent_id": req.agent_id, "deerflow_agent": name}


@router.post("/sync-all")
async def fusion_sync_all(user: User = Depends(require_admin)):
    """同步全部 penguin Agent 到 DeerFlow。"""
    from .agents import _all_agents

    agents = await _all_agents()
    seen: set[str] = set()
    synced = []
    for agent in agents:
        aid, pid = agent["agentId"], agent["project_id"]
        if aid in seen:
            continue
        seen.add(aid)
        name = await _sync_agent(aid, pid)
        synced.append({"agent_id": aid, "deerflow_agent": name})
    return {"success": True, "synced": synced}


@router.post("/chat")
async def fusion_chat(req: FusionChatRequest, user: User = Depends(require_developer)):
    """DeerFlow 运行时执行 penguin Agent：自动同步 → run（assistant_id）→ 轮询回复。

    多轮会话（评审 B）：复用 thread_id 保留上下文，DeerFlow 压缩机制生效。
    """
    req.agent_id = valid_id(req.agent_id, "agent_id")
    project_id = valid_id(req.project_id or "default_project", "project_id")
    thread_id = req.thread_id or f"dh-fusion-{uuid.uuid4().hex[:12]}"
    if req.thread_id:
        thread_id = valid_id(thread_id, "thread_id")
    deerflow_agent = await _sync_agent(req.agent_id, project_id)
    try:
        await _proxy_df("POST", "/api/threads", json={"thread_id": thread_id})
        run = await _proxy_df(
            "POST",
            f"/api/threads/{thread_id}/runs",
            json={
                "assistant_id": deerflow_agent,
                "input": {"messages": [{"role": "user", "content": req.message}]},
                "config": {"recursion_limit": 1000},
                "context": {
                    "model_name": DEFAULT_MODEL,
                    "mode": "flash",
                    "thinking_enabled": False,
                },
            },
        )
        run_id = run.get("run_id")

        deadline = time.monotonic() + POLL_TIMEOUT
        status = run.get("status", "pending")
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                raise HTTPException(status_code=504, detail="DeerFlow 任务超时")
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)

        if status in ("failed", "error", "cancelled"):
            record_trace("dh-fusion", status, task_goal=req.message[:200], thread_id=thread_id)
            raise HTTPException(
                status_code=502,
                detail=f"融合对话以 {status} 结束，请稍后重试",
            )

        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        reply = _extract_ai_reply(state)
        record_trace(
            "dh-fusion",
            "success",
            task_goal=req.message[:200],
            thread_id=thread_id,
            agent_version=deerflow_agent,
        )
        return {
            "reply": reply,
            "thread_id": thread_id,
            "deerflow_agent": deerflow_agent,
            "status": status,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"融合对话失败: {exc}")


class FusionTeamSyncRequest(BaseModel):
    agent_id: Optional[str] = None  # 指定单个；None = 全部
    template: Optional[str] = None  # 团队模板：限定成员班底 + 应用成员人设覆盖


class FusionTeamRunRequest(BaseModel):
    task: str
    agent_ids: Optional[list[str]] = None  # 指定团队成员；None = 模板成员（无模板则全部）
    template: Optional[str] = None  # 团队模板：预设主代理（orchestrator）人设 + 成员组成
    workflow: Optional[str] = None  # 同团队工作流预设（任务为空时套用其任务模板）


# ==================== 团队模板 ====================
# 多团队编排：每套模板 = 专属主代理（orchestrator 人设）+ 成员组成 + 内置工作流。
# - soul 含 {team_members} 占位符：运行时会动态注入真实团队成员清单（不再硬编码成员名）
# - members：None = 全部 penguin Agent；否则为限定成员 id 列表（不同团队不同班底）
# - workflows：同团队不同工作流预设（id/label/任务模板），前端选中后填入任务框可编辑
TEAM_TEMPLATES: dict[str, dict] = {
    "crossborder-ops": {
        "name": "dh-orchestrator",
        "icon": "🌏",
        "description": "跨境运营总监（全平台编排中心）：Amazon + TikTok Shop + 履约财税全局调度",
        "members": None,  # None = 全部 Agent 入队
        "soul": """你是 CrossBorder Ops 跨境运营总监（编排中心），统筹跨境电商运营的各类任务。

工作方式：
1. 接收运营任务后，先拆解为清晰的子任务；
2. 通过 task 工具把子任务分派给最合适的团队成员（子代理），可并行推进；
3. 汇总各成员结果，输出完整、可执行、面向跨境电商运营场景的结论（选品/定价/内容/物流/财税）。

当前团队成员（按需分派）：
{team_members}


任务边界：若缺少真实业务数据，请基于行业典型值给出合理假设并在输出中明确标注假设，务必交付可执行的框架、模板与结论，不要仅停留在提问。

风格：风格：简洁、专业、结果导向。""",
        "workflows": [
            {
                "id": "daily-inspection",
                "label": "日常运营巡检",
                "task": "对当前店铺做一次日常运营巡检并输出今日待办清单：\n1. Amazon：listing 状态、Buy Box、广告账户余额与异常、库存告警、待处理客服（含 A-to-Z）\n2. TikTok Shop：在售商品卡规范、达人合作进度、内容发布计划执行情况\n3. 合规红线检查与物流在途异常\n输出：按优先级排序的待办清单 + 每项负责人建议。",
            },
            {
                "id": "weekly-report",
                "label": "平台运营周报",
                "task": "生成上周平台运营周报：\n1. Amazon：销售额、ACoS/TACoS、Buy Box 赢得率、核心 ASIN 排名变化、库存周转\n2. TikTok Shop：GMV、GPM、内容曝光与转化、达人带货表现\n3. 竞品与价格动态、异常与风险\n输出：数据摘要 + 本周行动建议（含负责人）。",
            },
            {
                "id": "campaign-plan",
                "label": "大促活动策划",
                "task": "策划一次平台大促活动（Prime Day / 黑五 / 双十一任选其一）：\n1. 选品：哪些 ASIN/SKU 作为主推，理由（BSR、库存、利润）\n2. 定价与 Coupon/Deal 节奏、广告预算分配（SP/SB/SD 或 Spark Ads）\n3. 内容侧：A+ 更新、短视频/直播脚本要点、达人安排\n4. 库存与物流保障、风险预案\n输出：可执行的活动方案（含时间线与负责人）。",
            },
        ],
    },
    "amazon-ops": {
        "name": "dh-orchestrator-amazon",
        "icon": "🛒",
        "description": "Amazon 专项团队：Listing / 广告 / 定价竞品 / 库存 / 客服 / 合规 / 分析师",
        "members": [
            "pricing_compete",
            "ad_optimizer",
            "listing_seo",
            "inventory_forecast",
            "customer_reply",
            "compliance_review",
            "amazon_analyst",
        ],
        "soul": """你是 Amazon 专项运营指挥官，只负责 Amazon 站点（美国站优先）的精细化运营。

工作方式：
1. 把任务拆解为 Amazon 运营子任务（Listing / 广告 / 定价 / 库存 / 客服 / 合规）；
2. 通过 task 工具分派给对应专项成员，可并行；
3. 汇总为可直接执行的 Amazon 运营结论（含 ASIN、数据口径、责任人）。

当前团队成员（按需分派）：
{team_members}


任务边界：若缺少真实业务数据，请基于行业典型值给出合理假设并在输出中明确标注假设，务必交付可执行的框架、模板与结论，不要仅停留在提问。

风格：风格：数据说话、执行导向。""",
        "workflows": [
            {
                "id": "listing-optimize",
                "label": "Listing 优化",
                "task": "优化一批核心 ASIN 的 Listing：\n1. 标题与五点描述：关键词覆盖（前端+Search Terms）、卖点结构化、合规用词\n2. 图片与 A+ 内容建议、类目节点与 BSR 位置\n3. 差评/Review 结构分析及应对\n输出：每个 ASIN 的优化清单（逐条可执行）。",
            },
            {
                "id": "ad-review",
                "label": "广告复盘与调优",
                "task": "复盘最近广告投放并给出调优方案：\n1. 按 SP/SB/SD 分析 ACoS/TACoS、曝光-点击-转化漏斗\n2. 关键词：出单词 / 高花费无转化词 / 否定词建议\n3. 预算重分配建议（含理由）\n输出：广告优化表（结构 + 操作 + 预期效果）。",
            },
            {
                "id": "restock-forecast",
                "label": "补货与库存预测",
                "task": "给出核心 SKU 的补货计划：\n1. 日均销量与趋势、季节性因子、当前可售库存与在途\n2. FBA 仓容/仓储费、断货风险与冗余风险测算\n3. 建议补货量、批次节奏与发货渠道\n输出：补货计划表。",
            },
            {
                "id": "competitor-watch",
                "label": "竞品与价格监控",
                "task": "监控核心竞品并输出应对建议：\n1. 竞品价格/评分/Review 数量变化、Buy Box 归属\n2. 跟卖监控结果与警告\n3. 定价/优惠券应对建议（含毛利测算）\n输出：竞品动态表 + 应对动作。",
            },
        ],
    },
    "tiktok-shop": {
        "name": "dh-orchestrator-tiktok",
        "icon": "🎵",
        "description": "TikTok Shop 专项团队：内容电商 / 达人生态 / 短视频广告 / 分析师",
        "members": [
            "product_sourcing",
            "content_generator",
            "ad_optimizer",
            "tiktok_analyst",
        ],
        "soul": """你是 TikTok Shop 专项运营指挥官，专注美区 TikTok Shop 的内容电商打法。

工作方式：
1. 把任务拆解为 TikTok Shop 子任务（选品 / 内容脚本 / Spark Ads / 达人 / GPM 复盘）；
2. 通过 task 工具分派给对应成员，可并行；
3. 汇总为可直接执行的 TikTok Shop 运营结论（含视频选题、达人名单、预算口径）。

当前团队成员（按需分派）：
{team_members}


任务边界：若缺少真实业务数据，请基于行业典型值给出合理假设并在输出中明确标注假设，务必交付可执行的框架、模板与结论，不要仅停留在提问。

风格：风格：内容感强、节奏快、数据导向。""",
        "workflows": [
            {
                "id": "content-week",
                "label": "内容周计划",
                "task": "制定未来一周的内容发布计划：\n1. 3-5 条短视频选题（挂钩在售商品与热点），含标题/钩子/脚本要点\n2. 与商品卡、Shop Tab、直播的联动安排\n3. 发布节奏与测试变量（素材 A/B）\n输出：内容日历表（日期/选题/形式/负责人）。",
            },
            {
                "id": "creator-collab",
                "label": "达人合作评估",
                "task": "给出达人合作方案：\n1. 达人筛选标准（类目匹配、粉丝画像、带货 GPM 数据、内容质量）\n2. 拟定合作 Brief：产品卖点、创作方向、佣金/样品政策\n3. 合作流程与数据跟踪指标\n输出：达人合作清单 + Brief 模板。",
            },
            {
                "id": "gpm-review",
                "label": "直播与 GPM 复盘",
                "task": "复盘最近 TikTok Shop 直播/短视频带货表现：\n1. GMV、GPM（千次观看成交）、转化漏斗（观看→点击→成交）\n2. 内容侧：哪类素材跑量、哪个话术/钩子有效\n3. Spark Ads 投放复盘与预算调整建议\n输出：复盘结论 + 下周优化动作。",
            },
        ],
    },
    "content-studio": {
        "name": "dh-orchestrator-content",
        "icon": "✍️",
        "description": "内容工厂：商品文案 / A+ 页面 / 短视频脚本 / 品牌故事",
        "members": [
            "product_sourcing",
            "content_generator",
            "listing_seo",
        ],
        "soul": """你是内容工厂主编，统筹所有对外内容的产出与质检。

工作方式：
1. 把内容需求拆解为子任务（Listing 文案 / A+ 页面 / 短视频脚本 / 品牌故事）；
2. 通过 task 工具分派给内容成员，可并行；
3. 汇总为风格统一、平台合规、可直接交付的内容稿件。

当前团队成员（按需分派）：
{team_members}


任务边界：若缺少真实业务数据，请基于行业典型值给出合理假设并在输出中明确标注假设，务必交付可执行的框架、模板与结论，不要仅停留在提问。

风格：风格：专业、有转化力、合规。""",
        "workflows": [
            {
                "id": "listing-copy",
                "label": "商品页文案",
                "task": "为指定商品产出完整商品页文案：\n1. 标题（前端关键词优先）+ 五点描述（卖点结构化）\n2. Search Terms 关键词组\n3. A+ 页面模块建议（图文结构）\n输出：可直接提交的文案稿。",
            },
            {
                "id": "short-video",
                "label": "短视频脚本",
                "task": "为指定商品产出 3 条短视频脚本：\n1. 每条：前 3 秒钩子、口播文案、画面分镜、字幕要点\n2. 适配 TikTok Shop 与 Amazon 短视频位\n3. 附 CTA（挂车/店铺/搜索词）\n输出：脚本卡（可直接拍摄）。",
            },
            {
                "id": "brand-story",
                "label": "品牌故事",
                "task": "撰写品牌故事与店铺形象文案：\n1. 品牌定位与差异化卖点\n2. 面向美区消费者的品牌故事（有情感共鸣）\n3. About Us / 店铺 banner 文案建议\n输出：完整文案稿。",
            },
        ],
    },
    "ops-support": {
        "name": "dh-orchestrator-ops",
        "icon": "📦",
        "description": "履约与财税支持：物流 / 报关 / 退税 / 财税 / 合规",
        "members": [
            "logistics_monitor",
            "customs_declare",
            "tax_rebate",
            "finance_tax",
            "compliance_review",
        ],
        "soul": """你是跨境电商中后台支持主管，负责履约、关务、税务与合规事务。

工作方式：
1. 把任务拆解为物流/报关/退税/财税/合规子任务；
2. 通过 task 工具分派给对应成员；
3. 汇总为可执行的方案（含费用测算、时间线、所需资料清单）。

当前团队成员（按需分派）：
{team_members}


任务边界：若缺少真实业务数据，请基于行业典型值给出合理假设并在输出中明确标注假设，务必交付可执行的框架、模板与结论，不要仅停留在提问。

风格：风格：严谨、合规、可落地。""",
        "workflows": [
            {
                "id": "logistics-plan",
                "label": "物流方案",
                "task": "为指定 SKU 制定物流方案：\n1. 渠道对比（快船/慢船/空运/海外仓）时效与成本\n2. 头程+尾程组合、补货批次与在途跟踪\n3. 风险预案（旺季延误、关税变动）\n输出：物流方案表（含费用测算）。",
            },
            {
                "id": "customs-plan",
                "label": "关税与合规",
                "task": "核查一批商品的进口合规与关税：\n1. HS 编码归类与关税税率、附加税（如 301 关税）\n2. 禁限售与认证要求（CPC/UL/EPA 等）\n3. 清关资料清单与风险提示\n输出：合规核查表。",
            },
            {
                "id": "tax-rebate",
                "label": "退税核算",
                "task": "核算近期出口退税：\n1. 适用退税率与征退差计算\n2. 单证要求（报关单/发票/结汇）与流程节点\n3. 风险点（逾期申报、单证不符）\n输出：退税核算表 + 操作指引。",
            },
        ],
    },
}


async def _read_penguin_agent_defs() -> list[dict]:
    """读取全部 penguin Agent 定义（跨项目去重）。"""
    from .agents import _all_agents

    agents = await _all_agents()
    seen: set[str] = set()
    out = []
    for agent in agents:
        aid = agent["agentId"]
        if aid in seen:
            continue
        seen.add(aid)
        definition = await _get_penguin_agent_def(aid, agent["project_id"])
        out.append(
            {
                "agent_id": aid,
                "name": agent.get("name", aid),
                "description": agent.get("description", ""),
                "project_id": agent["project_id"],
                "system_prompt": definition["system_prompt"],
                "tools": definition["tools"],
            }
        )
    return out


def _write_subagents_config(team: list[dict]) -> tuple[list[str], bool]:
    """把团队写入 deer-flow config.yaml 的 subagents.custom_agents。

    评审 B：hash 比对（变更才写）+ 原子写（tempfile + os.replace）+ 锁；
    保留 subagents 段外的全部内容，description 转义防 YAML 注入。
    返回 (成员列表, 是否发生变更)。
    """
    global _last_config_hash
    lines = ["subagents:", "  custom_agents:"]
    for member in team:
        agent_id = re.sub(r"[^A-Za-z0-9_-]", "-", member["agent_id"])
        prompt = member["system_prompt"] or f"你是 {member['name']}。"
        tools = member.get("tools") or list(_DEFAULT_TOOL_WHITELIST)
        desc = f"同步自 PenguinHarness Agent：{member['name']}".replace('"', "'")
        lines.append(f"    {agent_id}:")
        lines.append(f"      description: \"{desc}\"")
        lines.append("      system_prompt: |")
        lines.extend("        " + line for line in prompt.splitlines())
        # 显式工具白名单（评审遗留：tools:null 会继承父代理全部工具，能力放大）
        lines.append(f"      tools: [{', '.join(tools)}]")
        lines.append("      skills: null")
        lines.append("      model: inherit")
    block = "\n".join(lines) + "\n"

    with open(DEERFLOW_CONFIG, "r", encoding="utf-8") as f:
        content = f.read()

    if re.search(r"(?m)^subagents:", content):
        new_content = re.sub(
            r"(?ms)^subagents:.*?(?=^[a-z_]+:|\Z)", block, content, count=1
        )
    else:
        new_content = (
            content
            + "\n\n# ===== DeerHarness 融合：PenguinHarness Agent 团队 =====\n"
            + block
        )

    new_hash = hashlib.sha256(new_content.encode()).hexdigest()
    changed = new_hash != _last_config_hash
    if changed:
        with _config_lock:
            # 锁内二次比对，避免并发下重复写
            if new_hash != _last_config_hash:
                # 原子写：临时文件 + os.replace
                tmp = DEERFLOW_CONFIG + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(new_content)
                os.replace(tmp, DEERFLOW_CONFIG)
                _last_config_hash = new_hash
    return [m["agent_id"] for m in team], changed


async def _restart_deerflow_gateway() -> None:
    """重启 deer-flow gateway 容器（仅配置变更时由调用方触发）。

    异步化（评审 P1-3）：subprocess 阻塞最长 120s 会冻结整个事件循环，
    移入线程池；ready 轮询改 asyncio.sleep。
    进程内去重：120s 内重复触发直接等待就绪，不重复执行 docker restart。
    """
    global _last_restart_at
    now = time.monotonic()
    if _last_restart_at and now - _last_restart_at < _RESTART_DEDUP_S:
        await _wait_deerflow_ready()
        return
    _last_restart_at = now

    def _run() -> None:
        subprocess.run(
            ["docker", "compose", "-f", "docker/docker-compose.yaml", "restart", "gateway"],
            cwd=DEERFLOW_COMPOSE_DIR,
            capture_output=True,
            timeout=120,
            check=True,
        )

    try:
        await asyncio.to_thread(_run)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"重启 deer-flow 失败: {exc.stderr.decode(errors='ignore')[:200]}",
        )
    # 等待容器就绪（修复：重启窗口期请求 502）
    await _wait_deerflow_ready()


async def _wait_deerflow_ready(timeout_s: float = 60.0) -> None:
    """轮询 deer-flow 登录直到成功，避免 restart 窗口期 502（异步版）。"""
    import httpx as _httpx

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            resp = _httpx.post(
                f"{config.DEERFLOW_API}/api/v1/auth/login/local",
                data={
                    "username": config.DEERFLOW_EMAIL,
                    "password": config.DEERFLOW_PASSWORD,
                    "remember_me": "true",
                },
                timeout=5.0,
                trust_env=False,
            )
            if resp.status_code == 200:
                return
        except Exception:
            pass
        await asyncio.sleep(2)
    raise HTTPException(status_code=503, detail="deer-flow 重启后未就绪")


@router.post("/team/sync")
async def fusion_team_sync(req: Optional[FusionTeamSyncRequest] = None, user: User = Depends(require_admin)):
    """把全部（或指定）penguin Agent 注册为 DeerFlow 子代理团队并生效。"""
    team = await _read_penguin_agent_defs()
    if req and req.template:
        spec = TEAM_TEMPLATES.get(req.template) or {}
        allowed = spec.get("members")
        if allowed is not None:
            team = [m for m in team if m["agent_id"] in allowed]
    if req and req.agent_id:
        req.agent_id = valid_id(req.agent_id, "agent_id")
        team = [m for m in team if m["agent_id"] == req.agent_id]
        if not team:
            raise HTTPException(status_code=404, detail="Agent 不存在")
    if req and req.template:
        _apply_member_overrides(team, req.template)

    synced, changed = _write_subagents_config(team)
    if changed:
        await _restart_deerflow_gateway()
    return {"success": True, "team": synced, "config": DEERFLOW_CONFIG, "restarted": changed}


def _member_desc(member: dict) -> str:
    """提取成员的一行职责描述。

    优先 penguin 的 description 字段（区分度高）；回退 prompt 中首个
    非结构标记行；最后回退 name/agent_id（评审 P2-2：避免全员雷同）。
    """
    desc = (member.get("description") or "").strip()
    if desc:
        return desc[:60]
    prompt = member.get("system_prompt") or ""
    for line in prompt.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "以下职责说明", "其中提及", "You are PenguinHarness")):
            continue
        return line[:60]
    return member.get("name") or member.get("agent_id", "")


async def _sync_orchestrator(template: str, team_members: list[dict]) -> str:
    """同步模板主代理为 DeerFlow Custom Agent（幂等）。

    soul 动态注入真实团队成员清单（id：角色 — 职责），替代硬编码成员名。
    """
    spec = TEAM_TEMPLATES.get(template)
    if not spec:
        raise HTTPException(status_code=404, detail=f"未知团队模板: {template}")
    members_text = "\n".join(
        f"- {m['agent_id']}：{m['name']} — {_member_desc(m)}" for m in team_members
    )
    soul = evolution_store.get_effective_soul(template, spec["soul"])
    # replace 而非 format：覆盖后的 soul 可能丢失占位符或含花括号（LLM 生成），
    # .format 会抛 KeyError/ValueError；replace 无此风险
    soul = soul.replace("{team_members}", members_text)
    name = spec["name"]
    agents = await _proxy_df("GET", "/api/agents")
    exists = any(a.get("name") == name for a in agents.get("agents", []))
    if exists:
        await _proxy_df("PUT", f"/api/agents/{name}", json={"soul": soul})
    else:
        await _proxy_df(
            "POST",
            "/api/agents",
            json={
                "name": name,
                "description": spec["description"],
                "model": DEFAULT_MODEL,
                "soul": soul,
            },
        )
    return name


@router.get("/team/templates")
async def fusion_team_templates():
    """列出可用团队模板：主代理、成员组成（None=全部）与内置工作流。"""
    return {
        "templates": [
            {
                "name": key,
                "icon": spec.get("icon", "🧭"),
                "description": spec["description"],
                "members": spec.get("members"),  # None = 全部 Agent
                "workflows": [
                    {**w, "task": evolution_store.get_effective_workflow_task(key, w["id"], w["task"])}
                    for w in spec.get("workflows", [])
                ],
            }
            for key, spec in TEAM_TEMPLATES.items()
        ]
    }


def _resolve_workflow_task(template: str | None, workflow_id: str | None, task: str) -> str:
    """工作流解析：任务为空时套用模板内置工作流的预设任务（用户可改后覆盖）。"""
    if not template or not workflow_id or task.strip():
        return task
    spec = TEAM_TEMPLATES.get(template) or {}
    for wf in spec.get("workflows", []):
        if wf["id"] == workflow_id:
            return evolution_store.get_effective_workflow_task(template, workflow_id, wf["task"])
    return task


class FusionEvaluateRequest(BaseModel):
    agent_id: str
    project_id: Optional[str] = None
    benchmark_id: str = "example-benchmark"
    max_cases: int = 3  # 评测用例数（成本控制）


@router.post("/evaluate")
async def fusion_evaluate(req: FusionEvaluateRequest, user: User = Depends(require_developer)):
    """进化闭环：执行轨迹 → 评测打分（评审遗留的闭环前半程）。

    流程：
    1. 同步 Agent 到 DeerFlow（记录版本基线 updatedAt）
    2. 从 penguin 拉取 benchmark cases（题目文本）
    3. 用 DeerFlow 运行时逐 case 执行（assistant_id = dh-<agent>）
    4. LLM 批量评分（0-100 + 点评，需配置 DEEPSEEK_API_KEY）
    5. 评测结果写入 traces（agent_id=eval:<agent>），支持版本间对比
    """
    req.agent_id = valid_id(req.agent_id, "agent_id")
    req.benchmark_id = valid_id(req.benchmark_id, "benchmark_id")
    project_id = valid_id(req.project_id or "default_project", "project_id")

    # 1. 同步（幂等），版本基线用 penguin 侧的 version（deer-flow agents API 无 updatedAt）
    deerflow_agent = await _sync_agent(req.agent_id, project_id)
    from .agents import _all_agents as _list_agents

    penguin_agents = await _list_agents()
    version_baseline = next(
        (str(a.get("version", "")) for a in penguin_agents if a.get("agentId") == req.agent_id),
        "",
    )

    # 2. 拉取 benchmark cases
    cases = await _fetch_benchmark_cases(project_id, req.agent_id, req.benchmark_id, req.max_cases)
    if not cases:
        raise HTTPException(
            status_code=404,
            detail="该 Agent 未配置 benchmark 或没有可用 cases（default_agent 内置 example-benchmark）",
        )

    # 3. 逐 case 用 DeerFlow 执行
    results = []
    for case in cases:
        reply, status = await _run_case(deerflow_agent, case["statement"])
        results.append({**case, "reply": reply, "run_status": status})

    # 4. LLM 批量评分
    scored = await _score_replies(results)

    avg = round(sum(s["score"] for s in scored) / len(scored), 1) if scored else 0.0
    report = {
        "agent_id": req.agent_id,
        "deerflow_agent": deerflow_agent,
        "benchmark_id": req.benchmark_id,
        "version_baseline": version_baseline,
        "average_score": avg,
        "cases": scored,
    }
    # 5. 记录评测轨迹（可对比连续两次评测的分数变化）
    record_trace(
        f"eval:{req.agent_id}",
        "success",
        task_goal=f"benchmark {req.benchmark_id} ({len(scored)} cases)",
        score=avg,
        benchmark_id=req.benchmark_id,
        version_baseline=version_baseline,
    )
    return report


async def _fetch_benchmark_cases(project_id: str, agent_id: str, benchmark_id: str, max_cases: int) -> list[dict]:
    """拉取评测 cases：优先内置评测集（dh-benchmark），否则走 penguin。"""
    builtin = _BUILTIN_BENCHMARKS.get(benchmark_id)
    if builtin is not None:
        return [{"id": c["id"], "title": c["title"], "statement": c["statement"]} for c in builtin[:max_cases]]
    base = f"/api/projects/{project_id}/agents/{agent_id}/benchmarks/{benchmark_id}/cases"
    try:
        resp = await penguin.request("GET", base)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="PenguinHarness 服务不可达")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    out = []
    for case in (data.get("cases") or [])[:max_cases]:
        case_id = case.get("id", "")
        statement = await _fetch_case_statement(project_id, agent_id, benchmark_id, case_id)
        out.append({"id": case_id, "title": case.get("title", case_id), "statement": statement})
    return out


async def _fetch_case_statement(project_id: str, agent_id: str, benchmark_id: str, case_id: str) -> str:
    """拉取单个 case 的 statement（markdown 任务说明）。"""
    base = f"/api/projects/{project_id}/agents/{agent_id}/benchmarks/{benchmark_id}/cases/{case_id}"
    try:
        files = await penguin.request("GET", base + "/files")
        entries = (files.json().get("entries") or []) if files.status_code == 200 else []
        if not entries:
            return ""
        name = entries[0].get("name", "")
        resp = await penguin.request("GET", base + "/files/content", params={"path": name})
        if resp.status_code == 200:
            return resp.text[:2000]
    except (httpx.ConnectError, httpx.TimeoutException):
        pass
    return ""


def _estimate_run_cost(run_detail: dict) -> float:
    """按 run 的真实 token 用量计价（USD）。"""
    inp = float(run_detail.get("total_input_tokens") or 0)
    out = float(run_detail.get("total_output_tokens") or 0)
    return round(
        inp / 1e6 * config.MODEL_INPUT_PRICE_PER_M + out / 1e6 * config.MODEL_OUTPUT_PRICE_PER_M,
        6,
    )


async def _run_case(deerflow_agent: str, statement: str) -> tuple[str, str, float]:
    """DeerFlow 以 dh-<agent> 身份执行单个评测 case，返回 (reply, status, cost)。"""
    if not statement:
        return "(无题目内容)", "skipped", 0.0
    thread_id = f"dh-eval-{uuid.uuid4().hex[:12]}"
    try:
        await _proxy_df("POST", "/api/threads", json={"thread_id": thread_id})
        run = await _proxy_df(
            "POST",
            f"/api/threads/{thread_id}/runs",
            json={
                "assistant_id": deerflow_agent,
                "input": {"messages": [{"role": "user", "content": statement}]},
                "config": {"recursion_limit": 1000},
                "context": {"model_name": DEFAULT_MODEL, "mode": "flash", "thinking_enabled": False},
            },
        )
        run_id = run.get("run_id")
        deadline = time.monotonic() + 180
        status = run.get("status", "pending")
        detail: dict = run
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                return "(评测超时)", "timeout", 0.0
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)
        if status in ("failed", "error", "cancelled"):
            return f"(run 状态: {status})", status, 0.0
        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        return _extract_ai_reply(state), status, _estimate_run_cost(detail)
    except HTTPException as exc:
        return f"(执行失败: {exc.detail})", "error", 0.0


async def _score_replies(results: list[dict]) -> list[dict]:
    """LLM 批量评分（0-100 + 点评）。需要 config.DEEPSEEK_API_KEY。"""
    if not config.DEEPSEEK_API_KEY:
        return [
            {
                **r,
                "score": 0,
                "comment": "未配置 DEEPSEEK_API_KEY，跳过 LLM 评分（仅返回执行结果）",
            }
            for r in results
        ]
    prompt = (
        "你是严格的 Agent 评测员。对下面每个评测 case，根据任务完成度给 Agent 回复打分（0-100 整数），"
        "并给一句简短点评。只输出 JSON 数组：[{\"id\":\"<case id>\",\"score\":<0-100>,\"comment\":\"<点评>\"}]。\n\n"
    )
    for r in results:
        prompt += f"## Case {r['id']}（{r['title']}）\n题目：{r['statement'][:500]}\nAgent 回复：{r['reply'][:800]}\n\n"
    try:
        resp = httpx.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {config.DEEPSEEK_API_KEY}"},
            json={
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 1500,
            },
            timeout=60,
            trust_env=False,
        )
        content = resp.json()["choices"][0]["message"]["content"]
        content = content.strip()
        # 剥离可能的 ```json 代码块包裹
        if content.startswith("```"):
            parts = content.split("```")
            content = parts[1] if len(parts) > 1 else content
            content = content.strip()
        # 提取 JSON 数组子串（模型可能夹杂说明文字）
        start, end = content.find("["), content.rfind("]")
        if start != -1 and end > start:
            content = content[start:end + 1]
        scores = json.loads(content)
    except Exception:
        scores = []
    score_map = {s.get("id"): s for s in scores if isinstance(s, dict)}
    out = []
    for r in results:
        s = score_map.get(r["id"], {})
        try:
            score = max(0, min(100, int(s.get("score", 0))))
        except (TypeError, ValueError):
            score = 0
        out.append({
            "id": r["id"],
            "title": r["title"],
            "score": score,
            "comment": str(s.get("comment", "") or "")[:200],
            "reply": r["reply"][:300],
        })
    return out


# 进行中的团队 run 注册表：thread_id → {team, started_at}（status 轮询需要成员清单）
_TEAM_RUNS: dict[str, dict] = {}
_TEAM_RUN_TTL = 1800.0  # 30 分钟过期清理


def _register_team_run(thread_id: str, team: list[dict]) -> None:
    """登记进行中的团队 run（含成员清单），同时清理过期条目。"""
    now = time.monotonic()
    stale = [k for k, v in _TEAM_RUNS.items() if now - v["started_at"] > _TEAM_RUN_TTL]
    for k in stale:
        _TEAM_RUNS.pop(k, None)
    _TEAM_RUNS[thread_id] = {"team": team, "started_at": now}


def _apply_member_overrides(team: list[dict], template: str) -> None:
    """应用团队成员人设覆盖（进化产物）到同步前的 team 定义。

    收敛点：_prepare_team / fusion_team_sync / 进化团队评测 共用此注入。
    """
    for m in team:
        effective = evolution_store.get_effective_member_prompt(
            m["agent_id"], m["system_prompt"], template
        )
        if effective != m["system_prompt"]:
            m["system_prompt"] = effective


async def _prepare_team(
    template: str | None, agent_ids: list[str] | None, task: str, workflow: str | None
) -> tuple[list[dict], str | None, str, list[str]]:
    """团队编排公共准备：成员过滤 + 配置同步 + 主代理同步。

    返回 (team, orchestrator, task, synced)。
    """
    team = await _read_penguin_agent_defs()

    # 模板成员限定：不同团队 = 不同班底（先按模板过滤，再按 agent_ids 收窄）
    if template:
        spec = TEAM_TEMPLATES.get(template) or {}
        allowed = spec.get("members")
        if allowed is not None:
            team = [m for m in team if m["agent_id"] in allowed]
        if not team:
            raise HTTPException(status_code=404, detail=f"团队模板 {template} 无可用成员")

    if agent_ids:
        team = [m for m in team if m["agent_id"] in agent_ids]
    if not team:
        raise HTTPException(status_code=404, detail="团队为空：请先在 penguin 创建 Agent")

    task = _resolve_workflow_task(template, workflow, task)
    if not task.strip():
        raise HTTPException(status_code=400, detail="任务内容为空")

    if template:
        _apply_member_overrides(team, template)

    synced, changed = _write_subagents_config(team)
    if changed:
        # 仅配置变化才重启（评审 B：避免每次请求杀并发 run）
        await _restart_deerflow_gateway()

    # 模板主代理（可选）：soul 注入真实团队清单
    orchestrator = None
    if template:
        orchestrator = await _sync_orchestrator(template, team)

    return team, orchestrator, task, synced


async def _start_team_thread(
    thread_id: str, task: str, workflow: str | None, orchestrator: str | None
) -> str:
    """创建线程并启动 run，返回 run_id（不阻塞等待完成）。"""
    await _proxy_df("POST", "/api/threads", json={"thread_id": thread_id})
    run_body: dict = {
        "input": {"messages": [{"role": "user", "content": task}], "workflow_id": workflow or ""},
        "config": {"recursion_limit": 2000},
        "context": {
            "model_name": DEFAULT_MODEL,
            "mode": "ultra",
            "subagent_enabled": True,
        },
    }
    if orchestrator:
        run_body["assistant_id"] = orchestrator
    run = await _proxy_df("POST", f"/api/threads/{thread_id}/runs", json=run_body)
    return run.get("run_id")


def _member_keywords(member: dict) -> list[str]:
    """成员关键词（用于把 task 分派归属到具体成员）。

    英文取 agent_id 分词；中文名加双字切分（"库存预测" → 库存/存预/预测），
    提升"预测库存与补货"这类换序表达的命中率。
    """
    keywords = set()
    for tok in member["agent_id"].replace("-", "_").split("_"):
        if len(tok) >= 2:
            keywords.add(tok.lower())
    name = (member.get("name") or "").replace("Agent", "").replace("agent", "").strip()
    if len(name) >= 2:
        keywords.add(name.lower())
    if any("\u4e00" <= ch <= "\u9fff" for ch in name):
        for i in range(len(name) - 1):
            keywords.add(name[i : i + 2].lower())
    return [k for k in keywords]


def _attribute_member(prompt: str, team: list[dict]) -> Optional[str]:
    """关键词打分：把 task 分派 prompt 归属到最匹配的成员（无法确定时返回 None）。"""
    best, best_score = None, 0
    text = (prompt or "").lower()
    for m in team:
        score = sum(1 for k in _member_keywords(m) if k in text)
        if score > best_score:
            best, best_score = m["agent_id"], score
    return best if best_score > 0 else None


def _parse_team_progress(state: dict, team: list[dict]) -> dict:
    """从线程状态解析各成员工作状态（idle/working/done/failed）。

    - AI 消息的 task tool_call → 该成员"工作中"（启动）
    - 对应的 tool 消息（subagent_status=completed）→ "已完成"
    - 无法归属的分派计入 other_* 计数（汇总展示用）
    """
    messages = (state.get("values") or {}).get("messages") or []
    started: dict[str, Optional[str]] = {}      # tool_call_id → member
    done_count: dict[str, int] = {}
    failed_count: dict[str, int] = {}
    other_started = other_done = other_failed = 0

    for m in messages:
        role = m.get("type") or m.get("role")
        if role == "ai":
            for tc in m.get("tool_calls") or []:
                if tc.get("name") == "task":
                    args = tc.get("args") or {}
                    prompt = f"{args.get('description', '')} {args.get('prompt', '')}"
                    started[tc.get("id")] = _attribute_member(prompt, team)
        elif role == "tool" and m.get("name") == "task":
            tcid = m.get("tool_call_id")
            member = started.get(tcid)
            sub_status = (m.get("additional_kwargs") or {}).get("subagent_status") or m.get("status")
            is_failed = sub_status in ("failed", "error") or m.get("status") in ("error", "failed")
            if member:
                (failed_count if is_failed else done_count)[member] = (
                    (failed_count if is_failed else done_count).get(member, 0) + 1
                )
            else:
                if is_failed:
                    other_failed += 1
                else:
                    other_done += 1

    # 启动但未完成 → 工作中
    completed_tcids = {
        m.get("tool_call_id")
        for m in messages
        if (m.get("type") or m.get("role")) == "tool" and m.get("name") == "task"
    }
    working_count: dict[str, int] = {}
    for tcid, member in started.items():
        if tcid in completed_tcids:
            continue
        if member:
            working_count[member] = working_count.get(member, 0) + 1
        else:
            other_started += 1

    members = []
    for m in team:
        aid = m["agent_id"]
        if failed_count.get(aid):
            members.append({"agent_id": aid, "state": "failed", "task_count": failed_count[aid]})
        elif done_count.get(aid):
            members.append({"agent_id": aid, "state": "done", "task_count": done_count[aid]})
        elif working_count.get(aid):
            members.append({"agent_id": aid, "state": "working", "task_count": working_count[aid]})
        else:
            members.append({"agent_id": aid, "state": "idle", "task_count": 0})

    return {
        "members": members,
        "delegations_total": len(completed_tcids),
        "other": {"started": other_started, "done": other_done, "failed": other_failed},
    }


@router.post("/team/run")
async def fusion_team_run(req: FusionTeamRunRequest, user: User = Depends(require_developer)):
    """团队编排（阻塞版）：主代理（DeerFlow）按需把子任务分派给团队成员（penguin Agent）。

    - 自动同步团队配置并重启使生效（首次调用）
    - 指定 template 时：以该团队的主代理身份编排 + 成员限定为该团队的班底
    - 指定 workflow 时：任务为空则套用同团队的内置工作流预设
    - 返回最终回复 + 编排过程（task 分派记录）
    """
    team, orchestrator, task, synced = await _prepare_team(
        req.template, req.agent_ids, req.task, req.workflow
    )

    thread_id = f"dh-team-{uuid.uuid4().hex[:12]}"
    try:
        # 阻塞版也注册（评审 P2-2：超时/中断后用户可用 team/status 找回成员归因）
        _register_team_run(thread_id, team)
        run_id = await _start_team_thread(thread_id, task, req.workflow, orchestrator)

        deadline = time.monotonic() + POLL_TIMEOUT
        status = "pending"
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                raise HTTPException(status_code=504, detail="团队任务超时")
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)

        if status in ("failed", "error", "cancelled"):
            # 失败不再伪装成功（评审 B）
            record_trace("dh-team", status, task_goal=task[:200], thread_id=thread_id)
            raise HTTPException(
                status_code=502,
                detail=f"团队任务以 {status} 结束，请稍后重试或查看 DeerFlow 线程 {thread_id}",
            )

        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        reply = _extract_ai_reply(state)
        delegation = _extract_delegations(state)
        # 观测闭环（评审 C）：记录轨迹 + 分派统计
        record_trace(
            "dh-team",
            "success",
            task_goal=task[:200],
            thread_id=thread_id,
            delegations=len(delegation),
            delegations_failed=sum(
                1 for d in delegation if "failed" in d.get("result", "").lower()
            ),
        )
        return {
            "reply": reply,
            "thread_id": thread_id,
            "status": status,
            "team": synced,
            "delegations": delegation,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"团队编排失败: {exc}")


class FusionTeamStartRequest(BaseModel):
    task: str
    agent_ids: Optional[list[str]] = None
    template: Optional[str] = None
    workflow: Optional[str] = None


@router.post("/team/start")
async def fusion_team_start(req: FusionTeamStartRequest, user: User = Depends(require_developer)):
    """团队编排（非阻塞版）：立即返回 thread_id，前端轮询 /team/status 展示实时进度。

    与 team/run 共享同一套准备逻辑（成员过滤 + 配置同步 + 主代理同步）。
    """
    team, orchestrator, task, synced = await _prepare_team(
        req.template, req.agent_ids, req.task, req.workflow
    )
    thread_id = f"dh-team-{uuid.uuid4().hex[:12]}"
    try:
        run_id = await _start_team_thread(thread_id, task, req.workflow, orchestrator)
        _register_team_run(thread_id, team)  # status 轮询需要成员清单
        return {
            "success": True,
            "thread_id": thread_id,
            "run_id": run_id,
            "team": synced,
            "template": req.template,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"团队编排启动失败: {exc}")


@router.get("/team/status/{thread_id}")
async def fusion_team_status(thread_id: str):
    """轮询团队 run 进度：各成员工作状态 + 分派统计（运行中 / 已结束）。"""
    thread_id = valid_id(thread_id, "thread_id")
    try:
        runs = await _proxy_df("GET", f"/api/threads/{thread_id}/runs")
        run_list = (
            runs.get("runs")
            if isinstance(runs, dict)
            else (runs if isinstance(runs, list) else [])
        )
        run = run_list[-1] if run_list else {}
        status = run.get("status", "unknown")
        run_id = run.get("run_id")

        # 成员清单：来自 /team/start 时的注册表（fallback 空团队 = 仅返回分派统计）
        run_info = _TEAM_RUNS.get(thread_id) or {}
        team = run_info.get("team") or []

        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        progress = _parse_team_progress(state, team)

        is_terminal = status not in ("pending", "running", "queued", "unknown")
        result = {
            "thread_id": thread_id,
            "status": status,
            "members": progress["members"],
            "delegations_total": progress["delegations_total"],
            "other": progress["other"],
            "terminal": is_terminal,
        }
        if is_terminal:
            result["reply"] = _extract_ai_reply(state)
            result["delegations"] = _extract_delegations(state)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"团队进度查询失败: {exc}")


def _extract_delegation_details(state: dict, team: list[dict]) -> dict:
    """按成员聚合本次会话的分派详情（分派任务 prompt + 执行结果）。

    供前端成员抽屉展示："点击成员 → 右侧推拉窗查看该成员会话内容"。
    """
    messages = (state.get("values") or {}).get("messages") or []
    started: dict[str, dict] = {}   # tool_call_id → {member, prompt}
    results: dict[str, dict] = {}   # tool_call_id → {result, status}
    for m in messages:
        role = m.get("type") or m.get("role")
        if role == "ai":
            for tc in m.get("tool_calls") or []:
                if tc.get("name") == "task":
                    args = tc.get("args") or {}
                    prompt = f"{args.get('description', '')}\n{args.get('prompt', '')}".strip()
                    started[tc.get("id")] = {
                        "member": _attribute_member(prompt, team),
                        "prompt": prompt[:3000],
                    }
        elif role == "tool" and m.get("name") == "task":
            tcid = m.get("tool_call_id")
            sub_status = (m.get("additional_kwargs") or {}).get("subagent_status") or m.get("status")
            results[tcid] = {
                "result": str(m.get("content", "") or "")[:6000],
                "status": "failed" if sub_status in ("failed", "error") else "completed",
            }

    members: dict[str, list[dict]] = {}
    other: list[dict] = []
    for tcid, s in started.items():
        item = {"prompt": s["prompt"], **(results.get(tcid) or {"result": "", "status": "running"})}
        if s["member"]:
            members.setdefault(s["member"], []).append(item)
        else:
            other.append(item)
    return {"members": members, "other": other}


@router.get("/team/delegations/{thread_id}")
async def fusion_team_delegations(thread_id: str):
    """成员分派详情：按成员聚合本次会话的任务（prompt）与结果（result）。"""
    thread_id = valid_id(thread_id, "thread_id")
    try:
        run_info = _TEAM_RUNS.get(thread_id) or {}
        team = run_info.get("team") or []
        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        details = _extract_delegation_details(state, team)
        return {"thread_id": thread_id, "members": details["members"], "other": details["other"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"分派详情查询失败: {exc}")


def _extract_delegations(state: dict) -> list[dict]:
    """从消息流中提取 task 工具调用（子代理分派记录）。"""
    out = []
    for m in (state.get("values") or {}).get("messages") or []:
        if m.get("type") != "tool" or m.get("name") != "task":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "".join(str(x.get("text", "")) for x in content if isinstance(x, dict))
        out.append({"tool": "task", "result": str(content)[:300]})
    return out


def _extract_ai_reply(state: dict) -> str:
    """从线程状态中提取最后一条非空 AI 消息内容。

    若主代理以澄清/追问收尾（如 ask_clarification 工具），
    把澄清问题作为回复呈现，而不是伪装"未返回内容"。
    """
    messages = (state.get("values") or {}).get("messages") or []
    for m in reversed(messages):
        role = m.get("type") or m.get("role")
        content = m.get("content", "")
        if isinstance(content, list):
            content = "".join(
                str(x.get("text", "")) for x in content if isinstance(x, dict)
            )
        if role == "ai" and content.strip():
            return content
        if role == "tool" and m.get("name") == "ask_clarification" and content.strip():
            return f"❓ 主代理需要更多信息：\n\n{content}"
    return "（DeerFlow 未返回内容）"
