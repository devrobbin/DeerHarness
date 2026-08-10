"""进化路由：代理到 PenguinHarness 真实 API。

真实 penguin-harness 的进化评测模型：
  GET /api/projects/:pid/agents/:aid/benchmarks     → Agent 已配置的 Benchmark 列表
  GET /api/projects/:pid/agents/:aid/benchmarks/:bid/cases → 评测用例
  （评测启动为 CLI 能力，HTTP API 未暴露）

因此：
  - GET  /api/evolution/tasks        → 跨 Agent 展开 Benchmark 列表
  - POST /api/evolution/start 等     → 返回 501，指向 CLI 用法
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .agents import _all_agents, _proxy


router = APIRouter()


@router.get("/tasks")
async def list_evolution_tasks():
    """跨项目/Agent 展开全部 Benchmark，作为进化任务清单。"""
    tasks = []
    for agent in await _all_agents():
        pid, aid = agent["project_id"], agent["agentId"]
        data = await _proxy("GET", f"/api/projects/{pid}/agents/{aid}/benchmarks")
        for bench in data.get("benchmarks", []):
            if not bench.get("benchmarkId"):
                continue  # 跳过未配置的占位项
            tasks.append({
                "task_id": f"{pid}/{aid}/{bench.get('benchmarkId')}",
                "agent_id": aid,
                "project_id": pid,
                "benchmark": bench.get("benchmarkId"),
                "name": bench.get("name"),
                "status": "configured",
            })
    return {"tasks": tasks}


@router.post("/start")
async def start_evolution():
    """启动进化：真实 penguin 仅支持 CLI 触发。

    用法示例：
      penguin run-benchmark --project <project_id> --agent <agent_id> --benchmark GDPevo
    """
    raise HTTPException(
        status_code=501,
        detail="PenguinHarness 的评测启动仅支持 CLI（penguin run-benchmark），HTTP API 未暴露；可先通过本接口查看已配置的 Benchmark 清单",
    )


@router.get("/tasks/{task_id}/status")
async def get_evolution_status(task_id: str):
    raise HTTPException(
        status_code=501,
        detail="真实 penguin-harness 未提供评测任务状态 HTTP 端点；请通过 CLI 或 WebUI 观测",
    )


@router.get("/tasks/{task_id}/versions")
async def get_version_comparison(task_id: str):
    raise HTTPException(
        status_code=501,
        detail="真实 penguin-harness 未提供版本对比 HTTP 端点；请通过 CLI 或 WebUI 观测",
    )
