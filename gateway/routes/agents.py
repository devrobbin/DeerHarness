"""Agent Studio 路由：代理到 PenguinHarness 真实 API。

真实 penguin-harness 的 Agent 模型（与千问框架假设不同）：
  GET/POST  /api/projects                            → 项目列表 / 创建
  GET/POST  /api/projects/:pid/agents                → 项目下 Agent 列表 / 创建
  GET/PATCH /api/projects/:pid/agents/:aid           → Agent 详情 / 更新
  DELETE    /api/projects/:pid/agents/:aid           → 删除

本路由把上述端点扁平化为 gateway 的 /api/agents 语义，
响应中携带 project_id 供 WebUI 与删除操作使用。
"""

from __future__ import annotations

import re
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from penguin_client import PenguinClient


router = APIRouter()
penguin = PenguinClient()

DEFAULT_PROJECT = "default_project"


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
    for agent in await _all_agents():
        if agent.get("agentId") == agent_id:
            return {"agent": agent, "project_id": agent["project_id"]}
    raise HTTPException(status_code=404, detail="Agent 不存在")


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, project_id: str):
    """删除 Agent（需指定所属项目）。"""
    await _proxy("DELETE", f"/api/projects/{project_id}/agents/{agent_id}")
    return {"success": True}


@router.get("/{agent_id}/versions")
async def list_agent_versions(agent_id: str):
    """Agent 版本（真实 penguin 为整数版本号）。"""
    for agent in await _all_agents():
        if agent.get("agentId") == agent_id:
            return {"versions": [agent.get("version", 1)], "current": agent.get("version", 1)}
    raise HTTPException(status_code=404, detail="Agent 不存在")
