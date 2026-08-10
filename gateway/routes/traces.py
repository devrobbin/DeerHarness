"""Trace 数据流路由：采集（DeerFlow 上报）→ 存储 → 查询。

Phase 2：DeerFlow 执行轨迹经此接口写入网关本地存储（config/traces.json），
供 Dashboard / Monitor / 进化数据闭环使用。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import os
import time
import uuid

from penguin_client import PenguinClient


router = APIRouter()

TRACES_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "traces.json")

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


def _load_traces() -> list[dict]:
    if os.path.exists(TRACES_FILE):
        with open(TRACES_FILE, "r") as f:
            return json.load(f)
    return []


def _save_traces(traces: list[dict]):
    os.makedirs(os.path.dirname(TRACES_FILE), exist_ok=True)
    with open(TRACES_FILE, "w") as f:
        json.dump(traces, f, indent=2, ensure_ascii=False)


@router.post("")
async def ingest_trace(event: TraceEvent):
    """DeerFlow 执行完成后回调上报轨迹。"""
    traces = _load_traces()
    record = {
        "trace_id": str(uuid.uuid4()),
        "received_at": time.time(),
        **event.model_dump(),
    }
    traces.append(record)
    _save_traces(traces)
    return {"success": True, "trace_id": record["trace_id"]}


@router.get("/penguin/{agent_id}")
async def penguin_traces(agent_id: str, project_id: str = "default_project"):
    """真实 PenguinHarness Agent 轨迹（按日期/会话聚合）。

    注意：本路由必须声明在 /{trace_id} 之前，避免路径冲突。
    """
    import httpx

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
    traces = _load_traces()
    if agent_id:
        traces = [t for t in traces if t["agent_id"] == agent_id]
    if status:
        traces = [t for t in traces if t["status"] == status]
    traces.sort(key=lambda t: t.get("received_at", 0), reverse=True)
    return {"traces": traces[:limit], "total": len(traces)}


@router.get("/{trace_id}")
async def get_trace(trace_id: str):
    for t in _load_traces():
        if t["trace_id"] == trace_id:
            return t
    raise HTTPException(status_code=404, detail="Trace 不存在")


@router.delete("/{trace_id}")
async def delete_trace(trace_id: str):
    traces = [t for t in _load_traces() if t["trace_id"] != trace_id]
    _save_traces(traces)
    return {"success": True}
