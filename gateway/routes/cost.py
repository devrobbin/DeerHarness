"""成本统计路由：基于 SQLite trace store 聚合（评审遗留：真实成本数据）。"""

from fastapi import APIRouter, HTTPException
from typing import Optional

import trace_store
from validate import valid_id


router = APIRouter()


@router.get("/summary")
async def cost_summary(days: Optional[int] = None):
    """按 Agent 聚合成本；days 指定只看最近 N 天。"""
    by_agent = trace_store.cost_summary(days=days)
    return {
        "total_cost": round(sum(v["cost"] for v in by_agent.values()), 4),
        "total_traces": sum(v["count"] for v in by_agent.values()),
        "by_agent": by_agent,
    }


@router.get("/agents/{agent_id}")
async def agent_cost(agent_id: str):
    """单个 Agent 的成本明细。"""
    agent_id = valid_id(agent_id, "agent_id")
    row = trace_store.agent_cost_row(agent_id)
    if row is None or row["count"] == 0:
        raise HTTPException(status_code=404, detail="该 Agent 暂无成本数据")
    return {"agent_id": agent_id, "traces": row["count"], "cost": round(row["cost"], 4)}


@router.get("/traces/{trace_id}")
async def trace_cost(trace_id: str):
    """单条轨迹的成本。"""
    trace_id = valid_id(trace_id, "trace_id")
    record = trace_store.get_trace(trace_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Trace 不存在")
    return {"trace_id": trace_id, "cost": round(float(record.get("cost") or 0), 4)}
