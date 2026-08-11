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
    """聚合统计：Agent / 任务 / 成本 / 团队编排 / 进化 / 趋势（SQL 端聚合，O(1) 扫描）。"""
    stats = trace_store.aggregate_stats()

    # 进化统计（evolution_store）
    try:
        import evolution_store
        evo = evolution_store.list_tasks(limit=1000)
    except Exception:
        evo = []
    evo_counts: dict[str, int] = {}
    for e in evo:
        evo_counts[e.get("status", "")] = evo_counts.get(e.get("status", ""), 0) + 1

    # Agent 数量：真实 penguin 跨项目展开；服务不可达时降级为 0
    try:
        agents = await _all_agents()
        agent_count = len(agents)
    except (httpx.HTTPError, HTTPException):
        agent_count = 0

    return {
        "agents": agent_count,
        "tasks": stats["tasks"],
        "tasks_success": stats["tasks_success"],
        "tasks_failed": stats["tasks_failed"],
        "traces": stats["traces"],
        "total_cost": stats["total_cost"],
        "team": stats["team"],
        "evolution": evo_counts,
        "daily_cost": trace_store.cost_by_day(7),
        "recent_scores": trace_store.recent_scores(8),
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
