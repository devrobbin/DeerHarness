"""Trace 数据流路由：采集（DeerFlow 上报 / 内部自动记录）→ 存储（SQLite）→ 查询。

供 Dashboard / Monitor / 进化数据闭环使用。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import trace_store
from penguin_client import PenguinClient
from validate import valid_id


router = APIRouter()

penguin = PenguinClient()


class TraceEvent(BaseModel):
    """DeerFlow 上报的一条执行轨迹。"""

    task_id: str
    agent_id: str
    agent_version: str = "latest"
    task_goal: str = ""
    status: str = "running"  # running / success / failed
    tool_calls: list[dict] = []
    output: str = ""
    score: Optional[float] = None
    user_liked: Optional[bool] = None
    root_cause: Optional[str] = None
    cost: Optional[float] = None  # USD
    metadata: dict = {}


# 兼容旧导入（chat/fusion 路由引用）
def record_trace(agent_id: str, status: str, **extra) -> dict:
    return trace_store.record_trace(agent_id, status, **extra)


@router.post("")
async def ingest_trace(event: TraceEvent):
    """DeerFlow 执行完成后回调上报轨迹。"""
    record = trace_store.record_trace(
        event.agent_id,
        event.status,
        task_goal=event.task_goal,
        tool_calls=event.tool_calls,
        output=event.output,
        score=event.score,
        user_liked=event.user_liked,
        root_cause=event.root_cause,
        cost=event.cost,
        metadata=event.metadata,
    )
    return {"success": True, "trace_id": record["trace_id"]}


@router.get("/penguin/{agent_id}")
async def penguin_traces(agent_id: str, project_id: str = "default_project"):
    """真实 PenguinHarness Agent 轨迹（按日期/会话聚合）。

    注意：本路由必须声明在 /{trace_id} 之前，避免路径冲突。
    """
    import httpx

    agent_id = valid_id(agent_id, "agent_id")
    project_id = valid_id(project_id, "project_id")
    try:
        resp = await penguin.request(
            "GET", f"/api/projects/{project_id}/agents/{agent_id}/traces"
        )
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="PenguinHarness 服务不可达")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("")
async def list_traces(limit: int = 50, agent_id: Optional[str] = None, status: Optional[str] = None):
    """查询轨迹列表（可按 Agent / 状态过滤）。"""
    traces = trace_store.list_traces(limit=limit, agent_id=agent_id, status=status)
    return {"traces": traces, "total": len(traces)}


@router.get("/{trace_id}")
async def get_trace(trace_id: str):
    trace_id = valid_id(trace_id, "trace_id")
    record = trace_store.get_trace(trace_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Trace 不存在")
    return record


@router.delete("/{trace_id}")
async def delete_trace(trace_id: str):
    trace_id = valid_id(trace_id, "trace_id")
    trace_store.delete_trace(trace_id)
    return {"success": True}
