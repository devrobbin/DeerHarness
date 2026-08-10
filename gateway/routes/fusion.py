"""Fusion Bridge：PenguinHarness 造 Agent → DeerFlow 运行时执行。

这才是真正的"融合"，而非门户聚合：
- PenguinHarness 负责 **Agent 定义**（system prompt / 描述，经 /config 端点拉取）
- DeerFlow 提供 **执行运行时**（沙箱 / 记忆 / 子代理 / 搜索 / 技能）
- 流程：读取 penguin Agent 定义 → 同步为 DeerFlow Custom Agent（soul）
  → 对话时以该 assistant 身份在 DeerFlow 中运行（assistant_id）
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deerflow_client import DeerFlowClient, DeerFlowError
from penguin_client import PenguinClient


router = APIRouter()
penguin = PenguinClient()
deerflow = DeerFlowClient()

DEFAULT_MODEL = "deepseek-v4-flash"
POLL_INTERVAL = 2.0
POLL_TIMEOUT = 240.0


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
