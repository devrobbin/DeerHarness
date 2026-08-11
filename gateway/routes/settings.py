from auth import User, require_admin
"""统一设置路由：模型 / 技能 / MCP / 渠道 / 安全策略 + 系统信息。

移植自上游 WebUI：
- PenguinHarness models-page：模型连通性测试（真实 HTTP 探测 + 延迟）
- DeerFlow tool-settings：MCP 启用开关 / 状态
- DeerFlow channels-settings：渠道连接状态测试
- DeerFlow about-settings：系统信息展示

存储为 JSON 文件（gateway/config/settings.json），全部端点受 API Key 保护。
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import asyncio
import httpx
import json
import os
import shlex
import subprocess
import time

import config


router = APIRouter()

VERSION = "0.5.0"

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


_PROVIDER_DEFAULTS = {
    "deepseek": "https://api.deepseek.com",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "local": "",
}


@router.get("/models")
async def list_models():
    config = _load_config()
    return {"models": config.get("models", [])}


@router.post("/models")
async def add_model(model: ModelConfig, user: User = Depends(require_admin)):
    config = _load_config()
    config.setdefault("models", []).append(model.model_dump())
    _save_config(config)
    return {"success": True, "model": model.model_dump()}


@router.put("/models/{model_id}")
async def update_model(model_id: str, model: ModelConfig, user: User = Depends(require_admin)):
    """编辑模型（移植 PenguinHarness ModelDialog 的完整字段）。"""
    config = _load_config()
    models = config.get("models", [])
    for i, m in enumerate(models):
        if m["id"] == model_id:
            models[i] = model.model_dump()
            _save_config(config)
            return {"success": True, "model": model.model_dump()}
    raise HTTPException(status_code=404, detail="模型不存在")


@router.delete("/models/{model_id}")
async def delete_model(model_id: str, user: User = Depends(require_admin)):
    config = _load_config()
    config["models"] = [m for m in config.get("models", []) if m["id"] != model_id]
    _save_config(config)
    return {"success": True}


class ModelTestRequest(BaseModel):
    """连通性测试：提交未保存的表单草稿也能测（移植 Penguin /models/test）。"""

    id: Optional[str] = None
    name: str
    provider: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    api_key_env: Optional[str] = None


@router.post("/models/test")
async def test_model(req: ModelTestRequest, user: User = Depends(require_admin)):
    """真实 HTTP 探测模型连通性：最小 chat completion + 延迟测量。

    trust_env=False：避免本机系统代理拦截外网请求（与 penguin_client 一致）。
    """
    base_url = (req.base_url or _PROVIDER_DEFAULTS.get(req.provider) or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="本地模型必须提供 base_url")
    _validate_test_url(base_url)
    api_key = _resolve_model_test_key(req, req.provider, base_url)

    headers = {"Authorization": f"Bearer {api_key}"}
    if req.provider == "anthropic":
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        endpoint = f"{base_url}/v1/messages"
        payload = {"model": req.name, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
    else:
        endpoint = f"{base_url}/chat/completions"
        payload = {"model": req.name, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}

    try:
        async with httpx_async_client() as client:
            start = time.perf_counter()
            resp = await client.post(endpoint, headers=headers, json=payload)
            latency = round((time.perf_counter() - start) * 1000, 1)
            if resp.status_code < 300:
                return {"ok": True, "latency_ms": latency, "message": f"HTTP {resp.status_code} · {latency}ms"}
            # 兼容未实现 /chat/completions 的服务端：退回 /models 列表
            if resp.status_code in (404, 405, 501):
                start = time.perf_counter()
                resp2 = await client.get(f"{base_url}/models", headers=headers)
                latency = round((time.perf_counter() - start) * 1000, 1)
                if resp2.status_code < 300:
                    return {"ok": True, "latency_ms": latency, "message": f"HTTP {resp2.status_code} (/models) · {latency}ms"}
                return {"ok": False, "latency_ms": latency, "message": f"HTTP {resp2.status_code}: {resp2.text[:160]}"}
            return {"ok": False, "latency_ms": latency, "message": f"HTTP {resp.status_code}: {resp.text[:160]}"}
    except (httpx.TimeoutException, httpx.ConnectError) as exc:
        return {"ok": False, "latency_ms": None, "message": f"连接失败: {exc}"}


# ==================== 技能管理 ====================


class SkillConfig(BaseModel):
    id: str
    name: str
    description: str
    type: str  # tool / workflow / prompt_template
    config: dict = {}
    enabled: bool = True


@router.get("/skills")
async def list_skills():
    config = _load_config()
    return {"skills": config.get("skills", [])}


@router.post("/skills")
async def add_skill(skill: SkillConfig, user: User = Depends(require_admin)):
    config = _load_config()
    config.setdefault("skills", []).append(skill.model_dump())
    _save_config(config)
    return {"success": True, "skill": skill.model_dump()}


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, skill: SkillConfig, user: User = Depends(require_admin)):
    config = _load_config()
    skills = config.get("skills", [])
    for i, s in enumerate(skills):
        if s["id"] == skill_id:
            skills[i] = skill.model_dump()
            _save_config(config)
            return {"success": True, "skill": skill.model_dump()}
    raise HTTPException(status_code=404, detail="技能不存在")


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, user: User = Depends(require_admin)):
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
    enabled: bool = True


@router.get("/mcp")
async def list_mcp_servers():
    config = _load_config()
    return {"mcp_servers": config.get("mcp_servers", [])}


@router.post("/mcp")
async def add_mcp_server(server: MCPServerConfig, user: User = Depends(require_admin)):
    config = _load_config()
    config.setdefault("mcp_servers", []).append(server.model_dump())
    _save_config(config)
    return {"success": True, "mcp_server": server.model_dump()}


@router.put("/mcp/{server_id}")
async def update_mcp_server(server_id: str, server: MCPServerConfig, user: User = Depends(require_admin)):
    config = _load_config()
    servers = config.get("mcp_servers", [])
    for i, s in enumerate(servers):
        if s["id"] == server_id:
            servers[i] = server.model_dump()
            _save_config(config)
            return {"success": True, "mcp_server": server.model_dump()}
    raise HTTPException(status_code=404, detail="MCP 服务器不存在")


@router.delete("/mcp/{server_id}")
async def delete_mcp_server(server_id: str, user: User = Depends(require_admin)):
    config = _load_config()
    config["mcp_servers"] = [s for s in config.get("mcp_servers", []) if s["id"] != server_id]
    _save_config(config)
    return {"success": True}


def _test_stdio(command: str, env: dict) -> dict:
    """stdio 探测：启动进程观察 2 秒，存活或正常退出视为 OK（移植 DeerFlow MCP 状态）。"""
    cmd = shlex.split(command)
    full_env = os.environ.copy()
    full_env.update(env)
    start = time.perf_counter()
    try:
        proc = subprocess.Popen(cmd, env=full_env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError as exc:
        return {"ok": False, "latency_ms": None, "message": f"命令不存在: {exc}"}
    try:
        returncode = proc.wait(timeout=2)
        latency = round((time.perf_counter() - start) * 1000, 1)
        if returncode == 0:
            return {"ok": True, "latency_ms": latency, "message": f"进程启动并正常退出 · {latency}ms"}
        stderr = (proc.stderr.read() if proc.stderr else "")[:200]
        return {"ok": False, "latency_ms": latency, "message": f"退出码 {returncode}: {stderr}"}
    except subprocess.TimeoutExpired:
        latency = round((time.perf_counter() - start) * 1000, 1)
        proc.terminate()
        return {"ok": True, "latency_ms": latency, "message": f"进程保持运行（2s 存活）· {latency}ms"}


@router.post("/mcp/{server_id}/test")
async def test_mcp_server(server_id: str, user: User = Depends(require_admin)):
    config = _load_config()
    server = next((s for s in config.get("mcp_servers", []) if s["id"] == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="MCP 服务器不存在")

    if server["transport"] == "sse":
        url = server.get("url")
        if not url:
            raise HTTPException(status_code=400, detail="SSE 传输需要 URL")
        _validate_test_url(url)
        try:
            async with httpx_async_client(timeout=8) as client:
                start = time.perf_counter()
                resp = await client.get(url, headers={"Accept": "text/event-stream"})
                latency = round((time.perf_counter() - start) * 1000, 1)
            if resp.status_code < 400:
                return {"ok": True, "latency_ms": latency, "message": f"HTTP {resp.status_code} · {latency}ms"}
            return {"ok": False, "latency_ms": latency, "message": f"HTTP {resp.status_code}: {resp.text[:160]}"}
        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            return {"ok": False, "latency_ms": None, "message": f"连接失败: {exc}"}

    command = server.get("command")
    if not command:
        raise HTTPException(status_code=400, detail="stdio 传输需要 command")
    return await asyncio.to_thread(_test_stdio, command, server.get("env") or {})


# ==================== 渠道集成 ====================


class ChannelConfig(BaseModel):
    id: str
    type: str  # feishu / slack / telegram / wechat
    name: str
    webhook_url: Optional[str] = None
    bot_token: Optional[str] = None
    enabled: bool = True


_CHANNEL_PAYLOADS = {
    # 各平台 webhook 的最小可识别消息结构
    "feishu": lambda t: {"msg_type": "text", "content": {"text": t}},
    "wechat": lambda t: {"msgtype": "text", "text": {"content": t}},
}


@router.get("/channels")
async def list_channels(user: User = Depends(require_admin)):
    config = _load_config()
    channels = []
    for c in config.get("channels", []):
        c = dict(c)
        if c.get("bot_token"):
            c["bot_token"] = "***"  # 掩码：令牌只写不回（评审 P1-5）
            c["bot_token_masked"] = True
        channels.append(c)
    return {"channels": channels}


@router.post("/channels")
async def add_channel(channel: ChannelConfig, user: User = Depends(require_admin)):
    config = _load_config()
    config.setdefault("channels", []).append(channel.model_dump())
    _save_config(config)
    return {"success": True, "channel": channel.model_dump()}


@router.put("/channels/{channel_id}")
async def update_channel(channel_id: str, channel: ChannelConfig, user: User = Depends(require_admin)):
    config = _load_config()
    channels = config.get("channels", [])
    for i, c in enumerate(channels):
        if c["id"] == channel_id:
            payload = channel.model_dump()
            if payload.get("bot_token") == "***":
                payload["bot_token"] = c.get("bot_token")  # 掩码占位 → 保留现有令牌
            channels[i] = payload
            _save_config(config)
            return {"success": True, "channel": payload}
    raise HTTPException(status_code=404, detail="渠道不存在")


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: str, user: User = Depends(require_admin)):
    config = _load_config()
    config["channels"] = [c for c in config.get("channels", []) if c["id"] != channel_id]
    _save_config(config)
    return {"success": True}


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: str, user: User = Depends(require_admin)):
    """发送一条真实测试消息到 webhook（移植 DeerFlow channels 连接状态检查）。"""
    config = _load_config()
    channel = next((c for c in config.get("channels", []) if c["id"] == channel_id), None)
    if not channel:
        raise HTTPException(status_code=404, detail="渠道不存在")
    url = channel.get("webhook_url")
    if not url:
        raise HTTPException(status_code=400, detail="未配置 webhook_url")
    _validate_test_url(url)

    text = f"DeerHarness 渠道连通性测试 ✅ {time.strftime('%Y-%m-%d %H:%M:%S')}"
    payload = (_CHANNEL_PAYLOADS.get(channel["type"]) or (lambda t: {"text": t}))(text)
    try:
        async with httpx_async_client(timeout=10) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code < 400:
            return {"ok": True, "status_code": resp.status_code, "message": f"测试消息已发送 · HTTP {resp.status_code}"}
        return {"ok": False, "status_code": resp.status_code, "message": f"HTTP {resp.status_code}: {resp.text[:160]}"}
    except (httpx.TimeoutException, httpx.ConnectError) as exc:
        return {"ok": False, "status_code": None, "message": f"连接失败: {exc}"}


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
async def update_safety(safety: SafetyConfig, user: User = Depends(require_admin)):
    config = _load_config()
    config["safety"] = safety.model_dump()
    _save_config(config)
    return {"success": True, "safety": safety.model_dump()}


# ==================== 安全护栏（评审 P0-3/P1-1/P1-3） ====================

import ipaddress as _ipaddress
import socket as _socket

# 预设 provider 官方域名：使用平台环境密钥（DEEPSEEK_API_KEY 等）时 base_url 必须命中
_PROVIDER_HOSTS = {
    "deepseek": ("api.deepseek.com", "api.deepseek.com"),
    "openai": ("api.openai.com",),
    "anthropic": ("api.anthropic.com",),
}
# openai/anthropic 默认 base_url 带 /v1 路径，host 校验只取主机名

_PRIVATE_NETS = [
    _ipaddress.ip_network("10.0.0.0/8"),
    _ipaddress.ip_network("172.16.0.0/12"),
    _ipaddress.ip_network("192.168.0.0/16"),
    _ipaddress.ip_network("127.0.0.0/8"),
    _ipaddress.ip_network("169.254.0.0/16"),
    _ipaddress.ip_network("100.64.0.0/10"),
    _ipaddress.ip_network("::1/128"),
    _ipaddress.ip_network("fc00::/7"),
    _ipaddress.ip_network("fe80::/10"),
]


def _host_of(url: str) -> str:
    """从 URL 提取主机名（剥掉协议与端口/路径）。"""
    url = (url or "").strip()
    if "://" not in url:
        url = "http://" + url
    try:
        from urllib.parse import urlparse
        return urlparse(url).hostname or ""
    except Exception:
        return ""


def _validate_test_url(url: str) -> None:
    """SSRF 防护：拒绝私网/回环/链路本地/云元数据段（评审 P1-3）。"""
    host = _host_of(url)
    if not host:
        raise HTTPException(status_code=400, detail="URL 无效")
    try:
        for addr in _socket.getaddrinfo(host, None):
            ip = _ipaddress.ip_address(addr[4][0])
            if any(ip in net for net in _PRIVATE_NETS):
                raise HTTPException(status_code=400, detail=f"禁止访问私网/回环地址: {ip}")
    except _socket.gaierror:
        raise HTTPException(status_code=400, detail=f"域名解析失败: {host}")


def _resolve_model_test_key(req, provider: str, base_url: str) -> str:
    """模型测试密钥解析 + 防外泄（评审 P1-1）。

    - 显式传入 api_key：用户自己的密钥，允许任意 base_url（风险自负）
    - 环境密钥（api_key_env / DEEPSEEK_API_KEY）：base_url host 必须命中
      对应 provider 官方域名，否则拒绝 —— 防止平台密钥被发往攻击者服务器
    """
    explicit = req.api_key
    env_key = os.environ.get(req.api_key_env) if req.api_key_env else None
    platform_key = config.DEEPSEEK_API_KEY if provider == "deepseek" else None
    if explicit:
        return explicit
    if not env_key and not platform_key:
        raise HTTPException(
            status_code=400,
            detail="未提供 API Key（可传入 api_key 或配置 api_key_env / DEEPSEEK_API_KEY）",
        )
    # 环境密钥 → 校验域名
    allowed = _PROVIDER_HOSTS.get(provider)
    host = _host_of(base_url)
    if allowed and host not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"环境密钥仅允许发送到 {provider} 官方域名（{allowed}），当前: {host}",
        )
    return env_key or platform_key


# ==================== 系统信息 ====================


def httpx_async_client(timeout: float = 10.0):
    """统一 HTTP 客户端：trust_env=False 避免系统代理拦截（与 penguin_client 一致）。"""
    return httpx.AsyncClient(trust_env=False, timeout=timeout)


@router.get("/system")
async def get_system():
    """系统信息：版本 + 上游健康 + 环境配置状态（移植 DeerFlow about / Penguin 状态）。

    只暴露掩码后的配置状态，绝不返回密码/密钥原文。
    """
    from .dashboard import _check_penguin, _check_deerflow  # 延迟导入避免循环依赖

    health = {"gateway": {"status": "up", "service": "deerharness-gateway"}}
    health["penguin"] = await _check_penguin()
    health["deerflow"] = await _check_deerflow()

    return {
        "version": VERSION,
        "env": {
            "penguin_api": config.PENGUIN_API,
            "penguin_user": config.PENGUIN_USER_ID,
            "deerflow_api": config.DEERFLOW_API,
            "deerflow_config": config.DEERFLOW_CONFIG,
            "deepseek_key_set": bool(config.DEEPSEEK_API_KEY),
            "admin_key_set": bool(config.ADMIN_API_KEY),
            "max_cost_per_request": config.MAX_COST_PER_REQUEST,
            "cors_origins": list(config.CORS_ORIGINS),
        },
        "health": health,
    }
