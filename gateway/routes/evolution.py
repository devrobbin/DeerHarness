from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
from ws import push_event


router = APIRouter()

PENGUIN_API = "http://localhost:7364"


class EvolutionStartRequest(BaseModel):
    agent_id: str
    benchmark: str = "GDPevo"
    max_rounds: int = 5
    target_score: Optional[float] = 90.0


@router.get("/tasks")
async def list_evolution_tasks():
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{PENGUIN_API}/api/evolution/tasks", timeout=10)
            if resp.status_code == 200:
                return resp.json()
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="获取进化任务超时")


@router.post("/start")
async def start_evolution(req: EvolutionStartRequest):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{PENGUIN_API}/api/evolution/start",
                json=req.model_dump(),
                timeout=600,
            )
            if resp.status_code == 200:
                result = resp.json()
                # 推送事件
                await push_event("evolution_started", {
                    "task_id": result.get("task_id"),
                    "agent_id": req.agent_id,
                    "benchmark": req.benchmark,
                })
                return result
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="进化任务启动超时")


@router.get("/tasks/{task_id}/status")
async def get_evolution_status(task_id: str):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{PENGUIN_API}/api/evolution/tasks/{task_id}", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                # 每次查询也推送更新
                await push_event("evolution_progress", data, channel=f"evolution:{task_id}")
                return data
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="查询状态超时")


@router.get("/tasks/{task_id}/versions")
async def get_version_comparison(task_id: str):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{PENGUIN_API}/api/evolution/tasks/{task_id}/versions", timeout=10)
            if resp.status_code == 200:
                return resp.json()
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="获取版本数据超时")
