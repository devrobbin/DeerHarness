from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import agents, evolution, traces, dashboard, cost, settings, users
from ws import router as ws_router


app = FastAPI(title="DeerHarness Gateway", version="0.7.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(evolution.router, prefix="/api/evolution", tags=["evolution"])
app.include_router(traces.router, prefix="/api/traces", tags=["traces"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(cost.router, prefix="/api/cost", tags=["cost"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(ws_router, tags=["websocket"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "deerharness-gateway", "version": "0.7.0"}
