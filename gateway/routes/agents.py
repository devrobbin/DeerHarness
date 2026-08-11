from __future__ import annotations
from auth import User, require_developer
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


import asyncio
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import config
import agent_prefs
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
async def create_agent(req: AgentCreateRequest, user: User = Depends(require_developer)):
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


# ==================== 项目模型与技能库（静态路由须在 /{agent_id} 前） ====================


@router.get("/models")
async def list_project_models():
    """项目可用模型列表（代理 penguin /api/projects/:p/models，含 default 标记）。"""
    data = await _proxy("GET", "/api/projects")
    projects = data.get("projects", [])
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for project in projects:
        pid = project["projectId"]
        models = (await _proxy("GET", f"/api/projects/{pid}/models")).get("models", [])
        for m in models:
            key = (m.get("provider", ""), m.get("modelId", ""))
            if key in seen or not all(key):
                continue
            seen.add(key)
            out.append({
                "provider": key[0],
                "model_id": key[1],
                "display_name": m.get("displayName") or key[1],
                "is_default": bool(m.get("isDefault")),
                "project_id": pid,
            })
    return {"models": out}


# ==================== 技能库（per-agent skills） ====================


@router.get("/skills-library")
async def list_skills_library():
    """技能库（代理 penguin GET /api/skills，分组列表）。"""
    return await _proxy("GET", "/api/skills")



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
    tools_builtin: Optional[list[dict]] = None  # 整表替换（penguin toolsBuiltin 契约）
    mcp_servers: Optional[list[dict]] = None    # 整表替换（penguin mcpServers 契约）


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
async def update_agent_config(agent_id: str, req: AgentConfigUpdate, user: User = Depends(require_developer)):
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
    if req.tools_builtin is not None:
        body["toolsBuiltin"] = req.tools_builtin
    if req.mcp_servers is not None:
        body["mcpServers"] = req.mcp_servers
    view = await _proxy(
        "PUT",
        f"/api/projects/{project_id}/agents/{agent_id}/config",
        json={"config": body},
    )
    return {"success": True, "agent_id": agent_id, "config": view.get("config", {})}


# ==================== 模型偏好（每 Agent 默认模型） ====================


class ModelPrefRequest(BaseModel):
    provider: Optional[str] = None
    model_id: Optional[str] = None


@router.get("/{agent_id}/model-pref")
async def get_agent_model_pref(agent_id: str):
    """每 Agent 默认模型偏好（DeerHarness 偏好层；penguin 原生为项目级）。"""
    agent_id = valid_id(agent_id, "agent_id")
    return {"agent_id": agent_id, "pref": agent_prefs.get_model_pref(agent_id)}


@router.put("/{agent_id}/model-pref")
async def set_agent_model_pref(agent_id: str, req: ModelPrefRequest, user: User = Depends(require_developer)):
    """设置/清除默认模型偏好（provider+model_id 都空 = 回落项目默认）。"""
    agent_id = valid_id(agent_id, "agent_id")
    await _find_agent_project(agent_id)  # 校验 agent 存在
    pref = agent_prefs.set_model_pref(agent_id, req.provider, req.model_id)
    return {"success": True, "agent_id": agent_id, "pref": pref}


@router.get("/{agent_id}/skills")
async def list_agent_skills(agent_id: str):
    """Agent 已安装技能。"""
    project_id = await _find_agent_project(agent_id)
    return await _proxy("GET", f"/api/projects/{project_id}/agents/{agent_id}/skills")


class SkillInstallRequest(BaseModel):
    names: list[str]


@router.post("/{agent_id}/skills")
async def install_agent_skills(agent_id: str, req: SkillInstallRequest, user: User = Depends(require_developer)):
    """安装技能（all-or-nothing）。"""
    project_id = await _find_agent_project(agent_id)
    return await _proxy(
        "POST",
        f"/api/projects/{project_id}/agents/{agent_id}/skills",
        json={"names": req.names},
    )


@router.delete("/{agent_id}/skills/{skill_name}")
async def uninstall_agent_skill(agent_id: str, skill_name: str, user: User = Depends(require_developer)):
    """卸载技能（penguin 返回 204 空 body，不能走 _proxy 的 JSON 解析）。"""
    project_id = await _find_agent_project(agent_id)
    skill_name = valid_id(skill_name, "skill_name")
    resp = await penguin.request(
        "DELETE", f"/api/projects/{project_id}/agents/{agent_id}/skills/{skill_name}"
    )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return {"success": True}


# ==================== Vault（环境变量） ====================


class VaultEntry(BaseModel):
    key: str
    value: Optional[str] = None  # None = 保留现有值


class VaultUpdateRequest(BaseModel):
    entries: list[VaultEntry]


@router.get("/{agent_id}/vault")
async def get_agent_vault(agent_id: str):
    """Agent Vault（环境变量，值已掩码）。"""
    project_id = await _find_agent_project(agent_id)
    return await _proxy("GET", f"/api/projects/{project_id}/agents/{agent_id}/vault")


@router.put("/{agent_id}/vault")
async def update_agent_vault(agent_id: str, req: VaultUpdateRequest, user: User = Depends(require_developer)):
    """整表替换 Vault（与 penguin 契约一致）。"""
    project_id = await _find_agent_project(agent_id)
    entries = [{"key": e.key, "value": e.value} if e.value is not None else {"key": e.key} for e in req.entries]
    return await _proxy(
        "PUT",
        f"/api/projects/{project_id}/agents/{agent_id}/vault",
        json={"entries": entries},
    )


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, project_id: str, user: User = Depends(require_developer)):
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
async def chat_with_agent(agent_id: str, req: AgentChatRequest, user: User = Depends(require_developer)):
    """与 Agent 对话：建会话（可复用）→ 发消息 → 轮询模型回复。

    回复判定：轮询消息流直到出现比发送前更新的 ``model_msg`` 且文本非空。
    """
    agent_id = valid_id(agent_id, "agent_id")
    # 解析 agent 真实所属项目（修复：跨项目 agent 无法聊天的历史 bug）
    project_id = valid_id(req.project_id or await _find_agent_project(agent_id), "project_id")
    session_id = valid_id(req.session_id, "session_id") if req.session_id else None
    try:
        # 1. 会话：复用或新建（新建时携带每 Agent 模型偏好 → penguin 会话级选择）
        session_id = req.session_id
        if not session_id:
            session_body: dict = {}
            pref = agent_prefs.get_model_pref(agent_id)
            if pref and pref.get("provider") and pref.get("model_id"):
                session_body["provider"] = pref["provider"]
                session_body["modelId"] = pref["model_id"]
            created = await _proxy(
                "POST", f"/api/projects/{project_id}/agents/{agent_id}/sessions",
                json=session_body,
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
