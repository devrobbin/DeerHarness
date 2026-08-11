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

from __future__ import annotations

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
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from deerflow_client import DeerFlowClient, DeerFlowError
from penguin_client import PenguinClient
from validate import valid_id
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
async def fusion_sync(req: FusionSyncRequest):
    """同步单个 penguin Agent 到 DeerFlow（幂等）。"""
    project_id = req.project_id or "default_project"
    name = await _sync_agent(req.agent_id, project_id)
    return {"success": True, "agent_id": req.agent_id, "deerflow_agent": name}


@router.post("/sync-all")
async def fusion_sync_all():
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
async def fusion_chat(req: FusionChatRequest):
    """DeerFlow 运行时执行 penguin Agent：自动同步 → run（assistant_id）→ 轮询回复。

    多轮会话（评审 B）：复用 thread_id 保留上下文，DeerFlow 压缩机制生效。
    """
    req.agent_id = valid_id(req.agent_id, "agent_id")
    project_id = valid_id(req.project_id or "default_project", "project_id")
    thread_id = req.thread_id or f"dh-fusion-{uuid.uuid4().hex[:12]}"
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


class FusionTeamRunRequest(BaseModel):
    task: str
    agent_ids: Optional[list[str]] = None  # 指定团队成员；None = 全部 penguin Agent
    template: Optional[str] = None  # 团队模板：预设主代理（orchestrator）人设


# ==================== 团队模板 ====================
# 预设主代理人设 + 编排指引，即"组合版本"的团队工作模式。
TEAM_TEMPLATES: dict[str, dict] = {
    "crossborder-ops": {
        "name": "dh-orchestrator",
        "description": "CrossBorder Ops 跨境运营总监（编排中心）",
        "soul": """你是 CrossBorder Ops 跨境运营总监（编排中心），统筹跨境电商运营的各类任务。

工作方式：
1. 接收运营任务后，先拆解为清晰的子任务；
2. 通过 task 工具把子任务分派给最合适的团队成员（子代理），可并行推进；
3. 汇总各成员结果，输出完整、可执行、面向跨境电商运营场景的结论（选品/定价/内容/物流/财税）。

团队成员：
- default_agent：通用执行 Agent（搜索、分析、报告）
- agent：代码/工单助手（开发、数据、流程自动化）
- summarizer：摘要专家（长文提炼、要点归纳）

风格：简洁、专业、结果导向。""",
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


def _restart_deerflow_gateway() -> None:
    """重启 deer-flow gateway 容器（仅配置变更时由调用方触发）。

    使用 `compose restart`（不重建镜像，快且不丢运行态）。
    """
    try:
        subprocess.run(
            ["docker", "compose", "-f", "docker/docker-compose.yaml", "restart", "gateway"],
            cwd=DEERFLOW_COMPOSE_DIR,
            capture_output=True,
            timeout=120,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"重启 deer-flow 失败: {exc.stderr.decode(errors='ignore')[:200]}",
        )


@router.post("/team/sync")
async def fusion_team_sync(req: Optional[FusionTeamSyncRequest] = None):
    """把全部（或指定）penguin Agent 注册为 DeerFlow 子代理团队并生效。"""
    team = await _read_penguin_agent_defs()
    if req and req.agent_id:
        req.agent_id = valid_id(req.agent_id, "agent_id")
        team = [m for m in team if m["agent_id"] == req.agent_id]
        if not team:
            raise HTTPException(status_code=404, detail="Agent 不存在")
    synced, changed = _write_subagents_config(team)
    if changed:
        _restart_deerflow_gateway()
    return {"success": True, "team": synced, "config": DEERFLOW_CONFIG, "restarted": changed}


async def _sync_orchestrator(template: str) -> str:
    """同步模板主代理为 DeerFlow Custom Agent（幂等），返回 agent 名。"""
    spec = TEAM_TEMPLATES.get(template)
    if not spec:
        raise HTTPException(status_code=404, detail=f"未知团队模板: {template}")
    name = spec["name"]
    agents = await _proxy_df("GET", "/api/agents")
    exists = any(a.get("name") == name for a in agents.get("agents", []))
    if exists:
        await _proxy_df("PUT", f"/api/agents/{name}", json={"soul": spec["soul"]})
    else:
        await _proxy_df(
            "POST",
            "/api/agents",
            json={
                "name": name,
                "description": spec["description"],
                "model": DEFAULT_MODEL,
                "soul": spec["soul"],
            },
        )
    return name


@router.post("/team/templates")
async def fusion_team_templates():
    """列出可用团队模板。"""
    return {
        "templates": [
            {"name": key, "description": spec["description"]}
            for key, spec in TEAM_TEMPLATES.items()
        ]
    }


class FusionEvaluateRequest(BaseModel):
    agent_id: str
    project_id: Optional[str] = None
    benchmark_id: str = "example-benchmark"
    max_cases: int = 3  # 评测用例数（成本控制）


@router.post("/evaluate")
async def fusion_evaluate(req: FusionEvaluateRequest):
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


async def _run_case(deerflow_agent: str, statement: str) -> tuple[str, str]:
    """DeerFlow 以 dh-<agent> 身份执行单个评测 case。"""
    if not statement:
        return "(无题目内容)", "skipped"
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
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                return "(评测超时)", "timeout"
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)
        if status in ("failed", "error", "cancelled"):
            return f"(run 状态: {status})", status
        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        return _extract_ai_reply(state), status
    except HTTPException as exc:
        return f"(执行失败: {exc.detail})", "error"


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


@router.post("/team/run")
async def fusion_team_run(req: FusionTeamRunRequest):
    """团队编排：主代理（DeerFlow）按需把子任务分派给团队成员（penguin Agent）。

    - 自动同步团队配置并重启使生效（首次调用）
    - 指定 template 时以模板主代理（如跨境运营总监）身份编排
    - 返回最终回复 + 编排过程（task 分派记录）
    """
    team = await _read_penguin_agent_defs()
    if req.agent_ids:
        team = [m for m in team if m["agent_id"] in req.agent_ids]
    if not team:
        raise HTTPException(status_code=404, detail="团队为空：请先在 penguin 创建 Agent")

    synced, changed = _write_subagents_config(team)
    if changed:
        # 仅配置变化才重启（评审 B：避免每次请求杀并发 run）
        _restart_deerflow_gateway()

    # 模板主代理（可选）
    orchestrator = None
    if req.template:
        orchestrator = await _sync_orchestrator(req.template)

    thread_id = f"dh-team-{uuid.uuid4().hex[:12]}"
    try:
        await _proxy_df("POST", "/api/threads", json={"thread_id": thread_id})
        run_body: dict = {
            "input": {"messages": [{"role": "user", "content": req.task}]},
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
        run_id = run.get("run_id")

        deadline = time.monotonic() + POLL_TIMEOUT
        status = run.get("status", "pending")
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                raise HTTPException(status_code=504, detail="团队任务超时")
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)

        if status in ("failed", "error", "cancelled"):
            # 失败不再伪装成功（评审 B）
            record_trace("dh-team", status, task_goal=req.task[:200], thread_id=thread_id)
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
            task_goal=req.task[:200],
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
    """从线程状态中提取最后一条非空 AI 消息内容。"""
    messages = (state.get("values") or {}).get("messages") or []
    for m in reversed(messages):
        role = m.get("type") or m.get("role")
        if role != "ai":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "".join(
                str(x.get("text", "")) for x in content if isinstance(x, dict)
            )
        if content.strip():
            return content
    return "（DeerFlow 未返回内容）"
