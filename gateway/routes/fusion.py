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
import json
import os
import re
import subprocess
import time
import uuid
from typing import Optional

import httpx
import yaml as _yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deerflow_client import DeerFlowClient, DeerFlowError
from penguin_client import PenguinClient


router = APIRouter()
penguin = PenguinClient()
deerflow = DeerFlowClient()

DEFAULT_MODEL = "deepseek-v4-flash"
POLL_INTERVAL = 2.0
POLL_TIMEOUT = 300.0

# deer-flow 运行配置（宿主机路径，与 docker-compose 挂载一致）
DEERFLOW_CONFIG = os.environ.get(
    "DEERFLOW_CONFIG", r"D:\ZhiCloud-WorkSpace\deer-flow-run\config.yaml"
)
DEERFLOW_COMPOSE_DIR = os.environ.get(
    "DEERFLOW_COMPOSE_DIR", r"D:\ZhiCloud-WorkSpace\deer-flow"
)


class FusionSyncRequest(BaseModel):
    agent_id: str
    project_id: Optional[str] = None


class FusionChatRequest(BaseModel):
    agent_id: str
    message: str
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
    yaml_text = data.get("systemConfigYaml") or ""
    if yaml_text:
        import yaml as _yaml

        try:
            cfg = _yaml.safe_load(yaml_text) or {}
            prompt = str(cfg.get("system_prompt") or "")
        except Exception:
            pass
    return {"system_prompt": prompt}


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
    """DeerFlow 运行时执行 penguin Agent：自动同步 → run（assistant_id）→ 轮询回复。"""
    project_id = req.project_id or "default_project"
    deerflow_agent = await _sync_agent(req.agent_id, project_id)
    thread_id = f"dh-fusion-{uuid.uuid4().hex[:12]}"
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

        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        reply = _extract_ai_reply(state)
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
            }
        )
    return out


def _write_subagents_config(team: list[dict]) -> list[str]:
    """把团队写入 deer-flow config.yaml 的 subagents.custom_agents（保留注释）。"""
    with open(DEERFLOW_CONFIG, "r", encoding="utf-8") as f:
        content = f.read()

    lines = ["subagents:", "  custom_agents:"]
    for member in team:
        agent_id = re.sub(r"[^A-Za-z0-9_-]", "-", member["agent_id"])
        prompt = member["system_prompt"] or f"你是 {member['name']}。"
        lines.append(f"    {agent_id}:")
        lines.append(f'      description: "同步自 PenguinHarness Agent：{member["name"]}"')
        lines.append("      system_prompt: |")
        lines.extend("        " + line for line in prompt.splitlines())
        lines.append("      tools: null")
        lines.append("      skills: null")
        lines.append("      model: inherit")
    block = "\n".join(lines) + "\n"

    if re.search(r"(?m)^subagents:", content):
        content = re.sub(r"(?ms)^subagents:.*?(?=^[a-z_]+:|\Z)", block, content, count=1)
    else:
        content += "\n\n# ===== DeerHarness 融合：PenguinHarness Agent 团队 =====\n" + block

    with open(DEERFLOW_CONFIG, "w", encoding="utf-8") as f:
        f.write(content)
    return [m["agent_id"] for m in team]


def _restart_deerflow_gateway() -> None:
    """重启 deer-flow gateway 容器使 subagents 配置生效（宿主机执行 docker）。"""
    try:
        subprocess.run(
            ["docker", "compose", "-f", "docker/docker-compose.yaml", "up", "-d", "gateway"],
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
        team = [m for m in team if m["agent_id"] == req.agent_id]
        if not team:
            raise HTTPException(status_code=404, detail="Agent 不存在")
    synced = _write_subagents_config(team)
    _restart_deerflow_gateway()
    return {"success": True, "team": synced, "config": DEERFLOW_CONFIG}


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

    synced = _write_subagents_config(team)
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

        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        reply = _extract_ai_reply(state)
        delegation = _extract_delegations(state)
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
