"""Agent Studio 路由：代理到 PenguinHarness 真实 API。

真实 penguin-harness 的 Agent 模型（与千问框架假设不同）：
  GET/POST  /api/projects                            → 项目列表 / 创建
  GET/POST  /api/projects/:pid/agents                → 项目下 Agent 列表 / 创建
  GET/PATCH /api/projects/:pid/agents/:aid           → Agent 详情 / 更新
  DELETE    /api/projects/:pid/agents/:aid           → 删除
  POST      /api/projects/:pid/agents/:aid/sessions  → 创建 Agent 会话
  POST      /api/sessions/:sid/tasks                 → 发送消息（input: [{type:"text", text}]）
  GET       /api/sessions/:sid/messages              → 消息流（type: model_msg = 模型回复）

本路由把上述端点扁平化为 gateway 的 /api/agents 语义，
响应中携带 project_id 供 WebUI 与删除操作使用。
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from penguin_client import PenguinClient
from validate import valid_id


router = APIRouter()
penguin = PenguinClient()

DEFAULT_PROJECT = "default_project"

REPLY_POLL_INTERVAL = 2.0
REPLY_POLL_TIMEOUT = 180.0


class AgentCreateRequest(BaseModel):
    name: str
    description: str = ""
    system_prompt: Optional[str] = None
    tools: list[str] = []
    model: Optional[str] = None
    project_id: Optional[str] = None
    agent_id: Optional[str] = None


async def _proxy(method: str, path: str, **kwargs) -> dict:
    """统一的 penguin 代理调用：网络错误 → 502/504，业务错误透传状态码。"""
    try:
        resp = await penguin.request(method, path, **kwargs)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="PenguinHarness 服务响应超时")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="PenguinHarness 服务不可达")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


def _slugify(name: str, max_len: int = 60) -> str:
    """生成符合 penguin project/agent id 规则的 slug（小写字母数字下划线）。"""
    slug = re.sub(r"[^a-z0-9_]", "_", name.strip().lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    if not slug:
        slug = "agent"
    return slug[:max_len]


async def _all_agents() -> list[dict]:
    """跨项目展开全部 Agent（扁平化，携带 project_id）。"""
    data = await _proxy("GET", "/api/projects")
    out: list[dict] = []
    for project in data.get("projects", []):
        pid = project["projectId"]
        agents = await _proxy("GET", f"/api/projects/{pid}/agents")
        for agent in agents.get("agents", []):
            out.append({**agent, "project_id": pid})
    return out


@router.get("")
async def list_agents():
    """列出全部 Agent（跨项目）。"""
    return {"agents": await _all_agents()}


@router.post("")
async def create_agent(req: AgentCreateRequest):
    """创建 Agent：未指定项目时使用 default_project。"""
    project_id = req.project_id or DEFAULT_PROJECT
    body = {
        "agentId": req.agent_id or _slugify(req.name),
        "name": req.name,
        "description": req.description,
        "systemPrompt": req.system_prompt,
    }
    result = await _proxy("POST", f"/api/projects/{project_id}/agents", json=body)
    return {"agent": result.get("agent"), "project_id": project_id}


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取 Agent 详情（跨项目查找）。"""
    agent_id = valid_id(agent_id, "agent_id")
    for agent in await _all_agents():
        if agent.get("agentId") == agent_id:
            return {"agent": agent, "project_id": agent["project_id"]}
    raise HTTPException(status_code=404, detail="Agent 不存在")


async def _find_agent_project(agent_id: str) -> str:
    """跨项目查找 Agent 所属项目（config 读写需要 projectId）。"""
    agent_id = valid_id(agent_id, "agent_id")
    for agent in await _all_agents():
        if agent.get("agentId") == agent_id:
            return agent["project_id"]
    raise HTTPException(status_code=404, detail="Agent 不存在")


class AgentModelConfig(BaseModel):
    max_tokens: Optional[int] = None
    thinking_level: Optional[str] = None  # none / low / medium / high / xhigh
    timeout_ms: Optional[int] = None


class AgentConfigUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    max_turns: Optional[int] = None
    model: Optional[AgentModelConfig] = None


def _to_penguin_model(model: AgentModelConfig) -> dict:
    """snake_case → penguin camelCase，仅包含非空字段（部分更新）。"""
    out: dict = {}
    if model.max_tokens is not None:
        out["maxTokens"] = model.max_tokens
    if model.thinking_level is not None:
        out["thinkingLevel"] = model.thinking_level
    if model.timeout_ms is not None:
        out["timeoutMs"] = model.timeout_ms
    return out


@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """Agent 配置（移植 PenguinHarness agent-settings-page：定义 / 人设 / 运行参数）。"""
    project_id = await _find_agent_project(agent_id)
    view = await _proxy("GET", f"/api/projects/{project_id}/agents/{agent_id}/config")
    return {"agent_id": agent_id, "project_id": project_id, "config": view.get("config", {})}


@router.put("/{agent_id}/config")
async def update_agent_config(agent_id: str, req: AgentConfigUpdate):
    """更新 Agent 配置（部分更新，与上游契约一致：{config: {...}}）。"""
    project_id = await _find_agent_project(agent_id)
    body: dict = {}
    if req.name is not None:
        body["name"] = req.name
    if req.description is not None:
        body["description"] = req.description
    if req.system_prompt is not None:
        body["systemPrompt"] = req.system_prompt
    if req.max_turns is not None:
        body["maxTurns"] = req.max_turns
    if req.model is not None:
        body["model"] = _to_penguin_model(req.model)
    view = await _proxy(
        "PUT",
        f"/api/projects/{project_id}/agents/{agent_id}/config",
        json={"config": body},
    )
    return {"success": True, "agent_id": agent_id, "config": view.get("config", {})}


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, project_id: str):
    """删除 Agent（需指定所属项目）。"""
    agent_id = valid_id(agent_id, "agent_id")
    project_id = valid_id(project_id, "project_id")
    await _proxy("DELETE", f"/api/projects/{project_id}/agents/{agent_id}")
    return {"success": True}


class AgentChatRequest(BaseModel):
    message: str
    project_id: Optional[str] = None
    session_id: Optional[str] = None


@router.post("/{agent_id}/chat")
async def chat_with_agent(agent_id: str, req: AgentChatRequest):
    """与 Agent 对话：建会话（可复用）→ 发消息 → 轮询模型回复。

    回复判定：轮询消息流直到出现比发送前更新的 ``model_msg`` 且文本非空。
    """
    agent_id = valid_id(agent_id, "agent_id")
    project_id = valid_id(req.project_id or DEFAULT_PROJECT, "project_id")
    session_id = valid_id(req.session_id, "session_id") if req.session_id else None
    try:
        # 1. 会话：复用或新建
        session_id = req.session_id
        if not session_id:
            created = await _proxy(
                "POST", f"/api/projects/{project_id}/agents/{agent_id}/sessions", json={}
            )
            session_id = created["session"]["sessionId"]

        # 2. 记录发送前最后一条 model_msg 时间戳
        before = _latest_model_msg(await _proxy("GET", f"/api/sessions/{session_id}/messages"))

        # 3. 发送任务
        await _proxy(
            "POST",
            f"/api/sessions/{session_id}/tasks",
            json={"input": [{"type": "text", "text": req.message}]},
        )

        # 4. 轮询新回复
        deadline = time.monotonic() + REPLY_POLL_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(REPLY_POLL_INTERVAL)
            ts, text = _latest_model_msg(
                await _proxy("GET", f"/api/sessions/{session_id}/messages")
            )
            if ts and ts != before and text.strip():
                return {"reply": text, "session_id": session_id, "agent_id": agent_id}
        raise HTTPException(status_code=504, detail="Agent 回复超时")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent 对话失败: {exc}")


def _latest_model_msg(messages: dict) -> tuple[Optional[str], str]:
    """返回消息流中最后一条 AI 回复的 (时间戳, 文本)。

    注意：penguin 会把用户输入先镜像为 model_msg（payload.role=user，回声），
    因此必须过滤 role=assistant 且 type=text 的消息。
    """
    latest_ts: Optional[str] = None
    latest_text = ""
    for m in messages.get("messages", []):
        if m.get("type") != "model_msg":
            continue
        payload = m.get("payload") or {}
        if payload.get("role") != "assistant" or payload.get("type") != "text":
            continue
        text = str(payload.get("text", "") or "")
        ts = m.get("timestamp")
        if ts and (latest_ts is None or ts > latest_ts):
            latest_ts, latest_text = ts, text
    return latest_ts, latest_text


@router.get("/{agent_id}/versions")
async def list_agent_versions(agent_id: str):
    """Agent 版本（真实 penguin 为整数版本号）。"""
    agent_id = valid_id(agent_id, "agent_id")
    for agent in await _all_agents():
        if agent.get("agentId") == agent_id:
            return {"versions": [agent.get("version", 1)], "current": agent.get("version", 1)}
    raise HTTPException(status_code=404, detail="Agent 不存在")
