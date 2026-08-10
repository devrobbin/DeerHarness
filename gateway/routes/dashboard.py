"""统一 Dashboard 路由：聚合统计 + 健康检查（Phase 3）。

聚合来源：Agent 工厂（PenguinHarness）、执行框架（DeerFlow）、
网关本地存储（traces.json / settings.json）。
"""

from fastapi import APIRouter
import httpx
import json
import os


router = APIRouter()

DEERFLOW_API = "http://localhost:8001"
PENGUIN_API = "http://localhost:7364"

TRACES_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "traces.json")


def _load_traces() -> list[dict]:
    if os.path.exists(TRACES_FILE):
        with open(TRACES_FILE, "r") as f:
            return json.load(f)
    return []


async def _check(url: str, path: str) -> dict:
    """探测一个上游服务的健康状态。"""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{url}{path}", timeout=3)
            return {"url": url, "status": "up" if resp.status_code < 500 else "degraded"}
    except (httpx.TimeoutException, httpx.ConnectError):
        return {"url": url, "status": "down"}


@router.get("/summary")
async def dashboard_summary():
    """聚合统计：Agent 数 / 任务数 / 进化任务 / 成本。"""
    traces = _load_traces()

    tasks = [t for t in traces if t.get("task_id")]
    success = sum(1 for t in tasks if t.get("status") == "success")
    failed = sum(1 for t in tasks if t.get("status") == "failed")
    total_cost = round(sum(float(t.get("cost") or 0) for t in traces), 4)

    # Agent 列表来源：PenguinHarness；失败时降级为 0
    agent_count = 0
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{PENGUIN_API}/api/agents", timeout=3)
            if resp.status_code == 200:
                agent_count = len(resp.json().get("agents", resp.json()))
    except (httpx.TimeoutException, httpx.ConnectError):
        pass

    return {
        "agents": agent_count,
        "tasks": len(tasks),
        "tasks_success": success,
        "tasks_failed": failed,
        "traces": len(traces),
        "total_cost": total_cost,
    }


@router.get("/health")
async def health_check():
    """三服务健康检查。"""
    penguin, deerflow = await _check(PENGUIN_API, "/api/health"), await _check(DEERFLOW_API, "/api/health")
    return {
        "gateway": {"status": "up", "service": "deerharness-gateway"},
        "penguin": penguin,
        "deerflow": deerflow,
    }
