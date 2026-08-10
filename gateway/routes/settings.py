from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import os


router = APIRouter()

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "settings.json")


def _load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {
        "models": [],
        "skills": [],
        "mcp_servers": [],
        "channels": [],
        "safety": {
            "max_evolution_rounds": 10,
            "max_cost_per_evolution": 5.0,
            "require_human_approval": True,
            "blocked_domains": [],
        },
    }


def _save_config(config: dict):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


# ==================== 模型管理 ====================


class ModelConfig(BaseModel):
    id: str
    name: str
    provider: str  # openai / deepseek / anthropic / local
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None
    max_tokens: int = 4096
    temperature: float = 0.7


@router.get("/models")
async def list_models():
    config = _load_config()
    return {"models": config.get("models", [])}


@router.post("/models")
async def add_model(model: ModelConfig):
    config = _load_config()
    config.setdefault("models", []).append(model.model_dump())
    _save_config(config)
    return {"success": True, "model": model.model_dump()}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    config = _load_config()
    config["models"] = [m for m in config.get("models", []) if m["id"] != model_id]
    _save_config(config)
    return {"success": True}


# ==================== 技能管理 ====================


class SkillConfig(BaseModel):
    id: str
    name: str
    description: str
    type: str  # tool / workflow / prompt_template
    config: dict = {}


@router.get("/skills")
async def list_skills():
    config = _load_config()
    return {"skills": config.get("skills", [])}


@router.post("/skills")
async def add_skill(skill: SkillConfig):
    config = _load_config()
    config.setdefault("skills", []).append(skill.model_dump())
    _save_config(config)
    return {"success": True, "skill": skill.model_dump()}


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str):
    config = _load_config()
    config["skills"] = [s for s in config.get("skills", []) if s["id"] != skill_id]
    _save_config(config)
    return {"success": True}


# ==================== MCP 配置 ====================


class MCPServerConfig(BaseModel):
    id: str
    name: str
    transport: str  # stdio / sse
    command: Optional[str] = None
    url: Optional[str] = None
    env: dict = {}


@router.get("/mcp")
async def list_mcp_servers():
    config = _load_config()
    return {"mcp_servers": config.get("mcp_servers", [])}


@router.post("/mcp")
async def add_mcp_server(server: MCPServerConfig):
    config = _load_config()
    config.setdefault("mcp_servers", []).append(server.model_dump())
    _save_config(config)
    return {"success": True, "mcp_server": server.model_dump()}


@router.delete("/mcp/{server_id}")
async def delete_mcp_server(server_id: str):
    config = _load_config()
    config["mcp_servers"] = [s for s in config.get("mcp_servers", []) if s["id"] != server_id]
    _save_config(config)
    return {"success": True}


# ==================== 渠道集成 ====================


class ChannelConfig(BaseModel):
    id: str
    type: str  # feishu / slack / telegram / wechat
    name: str
    webhook_url: Optional[str] = None
    bot_token: Optional[str] = None
    enabled: bool = True


@router.get("/channels")
async def list_channels():
    config = _load_config()
    return {"channels": config.get("channels", [])}


@router.post("/channels")
async def add_channel(channel: ChannelConfig):
    config = _load_config()
    config.setdefault("channels", []).append(channel.model_dump())
    _save_config(config)
    return {"success": True, "channel": channel.model_dump()}


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: str):
    config = _load_config()
    config["channels"] = [c for c in config.get("channels", []) if c["id"] != channel_id]
    _save_config(config)
    return {"success": True}


# ==================== 安全策略 ====================


class SafetyConfig(BaseModel):
    max_evolution_rounds: int = 10
    max_cost_per_evolution: float = 5.0
    require_human_approval: bool = True
    blocked_domains: list[str] = []


@router.get("/safety")
async def get_safety():
    config = _load_config()
    return {"safety": config.get("safety", {})}


@router.put("/safety")
async def update_safety(safety: SafetyConfig):
    config = _load_config()
    config["safety"] = safety.model_dump()
    _save_config(config)
    return {"success": True, "safety": safety.model_dump()}
