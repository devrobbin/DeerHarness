"""Chat 路由：DeerHarness WebUI → DeerFlow 真实对话代理。

流程（已按 DeerFlow 官方 API 实测）：
1. POST /api/threads                    → 创建线程（幂等）
2. POST /api/threads/{id}/runs          → flash 模式启动 run（跳过研究流程，快速回复）
3. GET  /api/threads/{id}/runs/{run_id} → 轮询直到终态
4. GET  /api/threads/{id}/state         → 提取最后一条 AI 回复

流式（POST /stream）：转发 DeerFlow SSE（event: values → messages 数组），
解析出 AI 文本增量逐段返回，实现打字机效果。
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import config
from deerflow_client import DeerFlowClient, DeerFlowError
from .traces import record_trace
from validate import valid_id


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


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    """流式对话：转发 DeerFlow SSE，提取 AI 文本增量（打字机效果）。"""
    thread_id = req.thread_id or f"dh-chat-{uuid.uuid4().hex[:12]}"
    try:
        await _proxy("POST", "/api/threads", json={"thread_id": thread_id})
        resp = await deerflow.open_stream(
            "POST",
            f"/api/threads/{thread_id}/runs/stream",
            json={
                "input": {"messages": [{"role": "user", "content": req.message}]},
                "config": {"recursion_limit": 1000},
                "context": {
                    "model_name": DEFAULT_MODEL,
                    "mode": "flash",
                    "thinking_enabled": False,
                },
            },
        )
    except DeerFlowError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.status_code != 200:
        detail = resp.text[:200]
        await resp.aclose()
        raise HTTPException(status_code=resp.status_code, detail=detail)

    async def event_source():
        try:
            yield f"event: meta\ndata: {json.dumps({'thread_id': thread_id})}\n\n"
            prev = ""
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    data = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                text = _latest_ai_text(data.get("messages") or [])
                if text.startswith(prev):
                    delta = text[len(prev):]
                elif prev:
                    delta = ""  # 内容重置（如思考→正文切换），等下一段
                else:
                    delta = text
                if delta:
                    yield f"event: text\ndata: {json.dumps(delta)}\n\n"
                prev = text
            # 观测闭环（评审 C）：流正常结束 → 记录轨迹
            record_trace(
                "dh-chat",
                "success",
                task_goal=req.message[:200],
                thread_id=thread_id,
                duration_s=round(time.monotonic() - _started, 1),
            )
            yield "event: done\ndata: {}\n\n"
        except Exception:
            record_trace("dh-chat", "error", task_goal=req.message[:200], thread_id=thread_id)
            raise
        finally:
            await resp.aclose()

    _started = time.monotonic()
    return StreamingResponse(event_source(), media_type="text/event-stream")


def _latest_ai_text(messages: list) -> str:
    """从 messages 数组中提取最后一条 AI 消息的纯文本。"""
    for m in reversed(messages):
        if m.get("type") != "ai":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            return "".join(str(x.get("text", "")) for x in content if isinstance(x, dict))
        return str(content or "")
    return ""


# ==================== 会话历史 ====================


@router.get("/threads")
async def list_threads(limit: int = 30):
    """列出最近的 DeerFlow 会话（历史记录）。"""
    data = await _proxy("POST", "/api/threads/search", json={"limit": limit})
    threads = [
        {
            "thread_id": t.get("thread_id"),
            "updated_at": t.get("updated_at"),
        }
        for t in data
        if isinstance(t, dict) and t.get("thread_id")
    ]
    return {"threads": threads}


@router.get("/threads/{thread_id}/messages")
async def get_thread_messages(thread_id: str):
    """读取历史会话的消息（人机交替）。"""
    state = await _proxy("GET", f"/api/threads/{thread_id}/state")
    out = []
    for m in (state.get("values") or {}).get("messages") or []:
        role = m.get("type")
        if role not in ("human", "ai"):
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "".join(str(x.get("text", "")) for x in content if isinstance(x, dict))
        if not content.strip():
            continue
        out.append({"role": "assistant" if role == "ai" else "user", "content": content})
    return {"messages": out, "thread_id": thread_id}


@router.post("")
async def chat(req: ChatRequest):
    """发送一条消息并等待 DeerFlow 模型回复。"""
    thread_id = req.thread_id or f"dh-chat-{uuid.uuid4().hex[:12]}"
    try:
        # 1. 创建线程（幂等）
        await _proxy("POST", "/api/threads", json={"thread_id": thread_id})

        # 2. 启动 run（flash 模式 + 指定模型 + 提高递归上限支持多轮工具调用）
        run = await _proxy(
            "POST",
            f"/api/threads/{thread_id}/runs",
            json={
                "input": {"messages": [{"role": "user", "content": req.message}]},
                "config": {"recursion_limit": 1000},
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

        if status in ("failed", "error", "cancelled"):
            # 失败不再伪装成"未返回内容"（评审 B）
            raise HTTPException(status_code=502, detail=f"DeerFlow 任务以 {status} 结束，请稍后重试")

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
