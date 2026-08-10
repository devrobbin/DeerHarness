from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from typing import Dict, Set
import json
import time

from auth import verify_api_key


router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器（单次 accept，订阅切换频道）。"""

    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.global_connections: Set[WebSocket] = set()

    def register(self, websocket: WebSocket, channel: str = "global"):
        """把连接注册到频道（连接已 accept，不做二次 accept）。"""
        if channel == "global":
            self.global_connections.add(websocket)
        else:
            self.active_connections.setdefault(channel, set()).add(websocket)

    def unregister(self, websocket: WebSocket, channel: str = "global"):
        if channel == "global":
            self.global_connections.discard(websocket)
        else:
            self.active_connections.get(channel, set()).discard(websocket)

    def unregister_all(self, websocket: WebSocket):
        self.global_connections.discard(websocket)
        for channel in self.active_connections.values():
            channel.discard(websocket)

    async def broadcast(self, message: dict, channel: str = "global"):
        data = json.dumps(message, ensure_ascii=False)
        targets = (
            self.global_connections.copy()
            if channel == "global"
            else self.active_connections.get(channel, set()).copy()
        )
        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:
                self.unregister(ws, channel)


manager = ConnectionManager()


async def _require_ws_auth(websocket: WebSocket) -> None:
    """WS 握手鉴权：?token=<api_key>（安全评审 P0-1）。"""
    token = websocket.query_params.get("token", "")
    if not token or not verify_api_key(token):
        await websocket.close(code=4401, reason="unauthorized")
        raise WebSocketDisconnect(4401)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """全局 WebSocket 端点（token 鉴权 + 频道订阅）。"""
    await _require_ws_auth(websocket)
    await websocket.accept()
    channel = "global"
    manager.register(websocket, channel)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "subscribe":
                new_channel = str(msg.get("channel", "global"))
                if new_channel != channel:
                    manager.unregister(websocket, channel)
                    channel = new_channel
                    manager.register(websocket, channel)
    except WebSocketDisconnect:
        manager.unregister_all(websocket)


@router.websocket("/ws/evolution/{task_id}")
async def evolution_ws(websocket: WebSocket, task_id: str):
    """进化任务专用 WebSocket（token 鉴权）。"""
    await _require_ws_auth(websocket)
    await websocket.accept()
    channel = f"evolution:{task_id}"
    manager.register(websocket, channel)
    try:
        while True:
            await websocket.receive_text()  # 保持连接
    except WebSocketDisconnect:
        manager.unregister(websocket, channel)


# 供其他路由调用的推送函数
async def push_event(event_type: str, data: dict, channel: str = "global"):
    await manager.broadcast({
        "type": event_type,
        "data": data,
        "timestamp": time.time(),
    }, channel)
