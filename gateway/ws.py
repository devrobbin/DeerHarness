from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import asyncio
import json


router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.global_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket, channel: str = "global"):
        await websocket.accept()
        if channel == "global":
            self.global_connections.add(websocket)
        else:
            if channel not in self.active_connections:
                self.active_connections[channel] = set()
            self.active_connections[channel].add(websocket)

    def disconnect(self, websocket: WebSocket, channel: str = "global"):
        if channel == "global":
            self.global_connections.discard(websocket)
        else:
            if channel in self.active_connections:
                self.active_connections[channel].discard(websocket)

    async def broadcast(self, message: dict, channel: str = "global"):
        data = json.dumps(message, ensure_ascii=False)
        targets = set()

        if channel == "global":
            targets = self.global_connections.copy()
        elif channel in self.active_connections:
            targets = self.active_connections[channel].copy()

        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:
                self.disconnect(ws, channel)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """全局 WebSocket 端点"""
    await manager.connect(websocket, "global")
    try:
        while True:
            data = await websocket.receive_text()
            # 客户端可发送订阅消息
            msg = json.loads(data)
            if msg.get("type") == "subscribe":
                channel = msg.get("channel", "global")
                await manager.connect(websocket, channel)
    except WebSocketDisconnect:
        manager.disconnect(websocket, "global")


@router.websocket("/ws/evolution/{task_id}")
async def evolution_ws(websocket: WebSocket, task_id: str):
    """进化任务专用 WebSocket"""
    channel = f"evolution:{task_id}"
    await manager.connect(websocket, channel)
    try:
        while True:
            await websocket.receive_text()  # 保持连接
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)


# 供其他路由调用的推送函数
async def push_event(event_type: str, data: dict, channel: str = "global"):
    await manager.broadcast({
        "type": event_type,
        "data": data,
        "timestamp": asyncio.get_event_loop().time(),
    }, channel)
