"""统一 Dashboard 路由：聚合统计 + 健康检查（Phase 3）。

聚合来源：PenguinHarness（真实 API，经 penguin_client 带会话代理）、
DeerFlow（执行框架）、网关本地 SQLite trace store。
"""

from fastapi import APIRouter, HTTPException
import httpx

import config
import trace_store
from penguin_client import PenguinClient

from .agents import _all_agents


router = APIRouter()

DEERFLOW_API = config.DEERFLOW_API  # 统一配置（评审：消除硬编码端口）
PENGUIN_API = config.PENGUIN_API

penguin = PenguinClient()


async def _check_penguin() -> dict:
    """PenguinHarness 健康检查（真实端点：/api/version，需会话）。"""
    try:
        resp = await penguin.request("GET", "/api/version", timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            return {"url": PENGUIN_API, "status": "up", "version": data.get("version")}
        return {"url": PENGUIN_API, "status": "degraded"}
    except (httpx.TimeoutException, httpx.ConnectError):
        return {"url": PENGUIN_API, "status": "down"}


async def _check_deerflow() -> dict:
    """DeerFlow 健康检查（真实官方栈：nginx 前门 :2026）。

    注意：DeerFlow 的 /api/health 需要认证（未带凭证返回 401），
    因此以 nginx 前门响应作为存活判据。
    """
    try:
        # trust_env=False：避免本机系统代理拦截回环地址（见 penguin_client 注释）
        async with httpx.AsyncClient(trust_env=False) as client:
            resp = await client.get(f"{DEERFLOW_API}/", timeout=3)
            return {"url": DEERFLOW_API, "status": "up" if resp.status_code < 500 else "degraded"}
    except (httpx.TimeoutException, httpx.ConnectError):
        return {"url": DEERFLOW_API, "status": "down"}


@router.get("/summary")
async def dashboard_summary():
    """聚合统计：Agent / 任务 / 成本 / 团队编排 / 进化 / 趋势（SQLite）。"""
    traces = trace_store.list_traces(limit=100000)

    tasks = [t for t in traces if t.get("task_goal")]
    success = sum(1 for t in tasks if t.get("status") == "success")
    failed = sum(1 for t in tasks if t.get("status") == "failed")
    total_cost = round(sum(float(t.get("cost") or 0) for t in traces), 4)

    # 团队编排统计（dh-team 轨迹）
    team_traces = [t for t in traces if str(t.get("agent_id", "")).startswith("dh-team")]
    team_runs = len(team_traces)
    team_delegations = sum(int(t.get("delegations") or 0) for t in team_traces)
    team_delegations_failed = sum(int(t.get("delegations_failed") or 0) for t in team_traces)

    # 进化统计（evolution_store）
    try:
        import evolution_store
        evo = evolution_store.list_tasks(limit=1000)
    except Exception:
        evo = []
    evo_counts: dict[str, int] = {}
    for e in evo:
        evo_counts[e.get("status", "")] = evo_counts.get(e.get("status", ""), 0) + 1

    # 7 日成本趋势 + 评测得分最近 8 条
    import time as _time
    now = _time.time()
    day_sec = 86400
    daily: list[dict] = []
    for i in range(6, -1, -1):
        start, end = now - (i + 1) * day_sec, now - i * day_sec
        day_cost = round(sum(float(t.get("cost") or 0) for t in traces if start <= (t.get("received_at") or 0) < end), 4)
        daily.append({"day": _time.strftime("%m-%d", _time.localtime(start)), "cost": day_cost})
    eval_traces = [
        {"agent_id": t.get("agent_id"), "score": t.get("score"), "received_at": t.get("received_at")}
        for t in traces
        if (str(t.get("agent_id", "")).startswith("eval:") or str(t.get("agent_id", "")).startswith("evolve:"))
        and t.get("score") is not None
    ][-8:]

    # Agent 数量：真实 penguin 跨项目展开；服务不可达时降级为 0
    try:
        agents = await _all_agents()
        agent_count = len(agents)
    except (httpx.HTTPError, HTTPException):
        agent_count = 0

    return {
        "agents": agent_count,
        "tasks": len(tasks),
        "tasks_success": success,
        "tasks_failed": failed,
        "traces": len(traces),
        "total_cost": total_cost,
        "team": {
            "runs": team_runs,
            "delegations": team_delegations,
            "delegations_failed": team_delegations_failed,
        },
        "evolution": evo_counts,
        "daily_cost": daily,
        "recent_scores": eval_traces,
    }


@router.get("/health")
async def health_check():
    """三服务健康检查（penguin 为真实探测）。"""
    penguin_health, deerflow_health = await _check_penguin(), await _check_deerflow()
    return {
        "gateway": {"status": "up", "service": "deerharness-gateway"},
        "penguin": penguin_health,
        "deerflow": deerflow_health,
    }
