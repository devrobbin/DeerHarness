"""Chat 路由：DeerHarness WebUI → DeerFlow 真实对话代理。

流程（已按 DeerFlow 官方 API 实测）：
1. POST /api/threads                    → 创建线程（幂等）
2. POST /api/threads/{id}/runs          → flash 模式启动 run（跳过研究流程，快速回复）
3. GET  /api/threads/{id}/runs/{run_id} → 轮询直到终态
4. GET  /api/threads/{id}/state         → 提取最后一条 AI 回复
"""

from __future__ import annotations

import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deerflow_client import DeerFlowClient, DeerFlowError


router = APIRouter()
deerflow = DeerFlowClient()

DEFAULT_MODEL = "deepseek-v4-flash"  # 与 DeerHarness 联调配置的模型
RUN_POLL_INTERVAL = 2.0
RUN_POLL_TIMEOUT = 240.0


class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = None


async def _proxy(method: str, path: str, **kwargs) -> dict:
    try:
        resp = await deerflow.request(method, path, **kwargs)
    except DeerFlowError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.post("")
async def chat(req: ChatRequest):
    """发送一条消息并等待 DeerFlow 模型回复。"""
    thread_id = req.thread_id or f"dh-chat-{uuid.uuid4().hex[:12]}"
    try:
        # 1. 创建线程（幂等）
        await _proxy("POST", "/api/threads", json={"thread_id": thread_id})

        # 2. 启动 run（flash 模式 + 指定模型）
        run = await _proxy(
            "POST",
            f"/api/threads/{thread_id}/runs",
            json={
                "input": {"messages": [{"role": "user", "content": req.message}]},
                "context": {
                    "model_name": DEFAULT_MODEL,
                    "mode": "flash",
                    "thinking_enabled": False,
                },
            },
        )
        run_id = run.get("run_id")

        # 3. 轮询直到终态
        deadline = time.monotonic() + RUN_POLL_TIMEOUT
        status = run.get("status", "pending")
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                raise HTTPException(
                    status_code=504,
                    detail="DeerFlow 任务超时，请稍后在 DeerFlow WebUI 查看",
                )
            await asyncio_sleep(RUN_POLL_INTERVAL)
            detail = await _proxy("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)

        # 4. 提取最后一条 AI 回复
        state = await _proxy("GET", f"/api/threads/{thread_id}/state")
        reply = _extract_ai_reply(state)
        return {
            "reply": reply,
            "thread_id": thread_id,
            "run_id": run_id,
            "status": status,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DeerFlow 调用失败: {exc}")


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


def _extract_ai_reply(state: dict) -> str:
    """从线程状态中提取最后一条非空 AI 消息内容。"""
    messages = (state.get("values") or {}).get("messages") or []
    for m in reversed(messages):
        role = m.get("type") or m.get("role")
        if role != "ai":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "".join(
                str(x.get("text", "")) for x in content if isinstance(x, dict)
            )
        if content.strip():
            return content
    return "（DeerFlow 未返回内容）"
