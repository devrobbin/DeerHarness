"""成本统计路由（Phase 4）。

成本数据来源：DeerFlow 上报轨迹（traces.json）中的 cost 字段，
按 Agent / 时间聚合。
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
import json
import os
import time
from collections import defaultdict


router = APIRouter()

TRACES_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "traces.json")


def _load_traces() -> list[dict]:
    if os.path.exists(TRACES_FILE):
        with open(TRACES_FILE, "r") as f:
            return json.load(f)
    return []


@router.get("/summary")
async def cost_summary(days: Optional[int] = None):
    """按 Agent 聚合成本；days 指定只看最近 N 天。"""
    traces = _load_traces()
    cutoff = (time.time() - days * 86400) if days else 0

    by_agent: dict[str, dict] = defaultdict(lambda: {"count": 0, "cost": 0.0})
    total_cost, total_count = 0.0, 0
    for t in traces:
        if cutoff and t.get("received_at", 0) < cutoff:
            continue
        agent = t.get("agent_id", "unknown")
        cost = float(t.get("cost") or 0)
        by_agent[agent]["count"] += 1
        by_agent[agent]["cost"] += cost
        total_cost += cost
        total_count += 1

    return {
        "total_cost": round(total_cost, 4),
        "total_traces": total_count,
        "by_agent": {
            agent: {"count": v["count"], "cost": round(v["cost"], 4)}
            for agent, v in sorted(by_agent.items(), key=lambda kv: -kv[1]["cost"])
        },
    }


@router.get("/agents/{agent_id}")
async def agent_cost(agent_id: str):
    """单个 Agent 的成本明细。"""
    traces = [t for t in _load_traces() if t.get("agent_id") == agent_id]
    if not traces:
        raise HTTPException(status_code=404, detail="该 Agent 暂无成本数据")
    cost = sum(float(t.get("cost") or 0) for t in traces)
    return {"agent_id": agent_id, "traces": len(traces), "cost": round(cost, 4)}


@router.get("/traces/{trace_id}")
async def trace_cost(trace_id: str):
    """单条轨迹的成本。"""
    for t in _load_traces():
        if t.get("trace_id") == trace_id:
            return {"trace_id": trace_id, "cost": round(float(t.get("cost") or 0), 4)}
    raise HTTPException(status_code=404, detail="Trace 不存在")
