"""Agent Studio 路由：代理到 PenguinHarness Agent 工厂 API。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx


router = APIRouter()

PENGUIN_API = "http://localhost:7364"


class AgentCreateRequest(BaseModel):
    name: str
    description: str = ""
    system_prompt: Optional[str] = None
    tools: list[str] = []
    model: Optional[str] = None
    memory_schema: dict = {}


async def _proxy(method: str, path: str, timeout: float = 10, **kwargs):
    """统一的 PenguinHarness API 代理调用。"""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.request(method, f"{PENGUIN_API}{path}", timeout=timeout, **kwargs)
            if resp.status_code == 200:
                return resp.json()
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="PenguinHarness 服务响应超时")


@router.get("")
async def list_agents():
    """列出全部 Agent"""
    return await _proxy("GET", "/api/agents")


@router.post("")
async def create_agent(req: AgentCreateRequest):
    """创建新 Agent"""
    return await _proxy("POST", "/api/agents", timeout=600, json=req.model_dump())


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取单个 Agent 详情"""
    return await _proxy("GET", f"/api/agents/{agent_id}")


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    """删除 Agent"""
    return await _proxy("DELETE", f"/api/agents/{agent_id}")


@router.get("/{agent_id}/versions")
async def list_agent_versions(agent_id: str):
    """列出 Agent 的全部版本"""
    return await _proxy("GET", f"/api/agents/{agent_id}/versions")
