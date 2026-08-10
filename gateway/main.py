from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from auth import bootstrap_admin, get_current_user
from routes import agents, chat, evolution, traces, dashboard, cost, settings, users, fusion
from ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动播种管理员（首个 API Key）
    admin = bootstrap_admin()
    if admin:
        print(f"[bootstrap] 已创建管理员账号: {admin.username} (role={admin.role})")
    yield
    # 关闭上游客户端会话
    for client in (agents.penguin, chat.deerflow, fusion.penguin, fusion.deerflow):
        try:
            await client.aclose()
        except Exception:
            pass


app = FastAPI(title="DeerHarness Gateway", version="0.7.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 除 /api/health 外全部路由挂鉴权（安全评审 P0-1）
app.include_router(agents.router, prefix="/api/agents", tags=["agents"],
                   dependencies=[Depends(get_current_user)])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"],
                   dependencies=[Depends(get_current_user)])
app.include_router(fusion.router, prefix="/api/fusion", tags=["fusion"],
                   dependencies=[Depends(get_current_user)])
app.include_router(evolution.router, prefix="/api/evolution", tags=["evolution"],
                   dependencies=[Depends(get_current_user)])
app.include_router(traces.router, prefix="/api/traces", tags=["traces"],
                   dependencies=[Depends(get_current_user)])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"],
                   dependencies=[Depends(get_current_user)])
app.include_router(cost.router, prefix="/api/cost", tags=["cost"],
                   dependencies=[Depends(get_current_user)])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"],
                   dependencies=[Depends(get_current_user)])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(ws_router, tags=["websocket"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "deerharness-gateway", "version": "0.7.0"}
