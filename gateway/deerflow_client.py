"""DeerFlow 官方栈客户端：表单登录 + CSRF 双提交 + 会话复用。

与 penguin_client 同理：trust_env=False 直连（避免本机系统代理拦截回环）。
认证契约（已实测）：
- POST /api/v1/auth/login/local（OAuth2 表单：username/password/remember_me）
  → 下发会话 cookie + csrf_token cookie
- 状态变更请求需带 X-CSRF-Token 头（双提交 cookie 值）
"""

from __future__ import annotations

import asyncio
import os

import httpx

DEERFLOW_API = os.environ.get("DEERFLOW_API", "http://localhost:2026")
DEERFLOW_EMAIL = os.environ.get("DEERFLOW_EMAIL", "admin@deerharness.com")
# DeerFlow 本地管理员账号（首次运行在 DeerFlow WebUI 创建）；
# 生产环境请通过 DEERFLOW_EMAIL / DEERFLOW_PASSWORD 环境变量注入
DEERFLOW_PASSWORD = os.environ.get("DEERFLOW_PASSWORD", "DeerHarness-2026")

_CSRF_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class DeerFlowError(RuntimeError):
    """DeerFlow 服务调用失败。"""


class DeerFlowClient:
    """带自动登录与 CSRF 头注入的 DeerFlow 官方栈客户端（单例使用）。"""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=DEERFLOW_API, timeout=60.0, trust_env=False)
        self._lock = asyncio.Lock()
        self._logged_in = False

    async def _login(self) -> None:
        async with self._lock:
            resp = await self._client.post(
                "/api/v1/auth/login/local",
                data={
                    "username": DEERFLOW_EMAIL,
                    "password": DEERFLOW_PASSWORD,
                    "remember_me": "true",
                },
            )
            if resp.status_code != 200:
                raise DeerFlowError(
                    f"deerflow 登录失败 ({resp.status_code}): {resp.text[:200]}"
                )
            self._logged_in = True

    async def request(
        self, method: str, path: str, *, csrf: bool = True, **kwargs
    ) -> httpx.Response:
        """发起请求；自动注入 CSRF 头；401/连接错误时重新登录重试一次。"""
        for attempt in range(2):
            if not self._logged_in:
                await self._login()
            headers = dict(kwargs.pop("headers", None) or {})
            if csrf and method.upper() in _CSRF_METHODS:
                token = self._client.cookies.get("csrf_token")
                if token:
                    headers["X-CSRF-Token"] = token
            try:
                resp = await self._client.request(method, path, headers=headers, **kwargs)
            except httpx.ConnectError:
                self._logged_in = False
                if attempt == 0:
                    continue
                raise
            if resp.status_code == 401 and self._logged_in:
                self._logged_in = False
                continue
            return resp
        raise DeerFlowError("deerflow 请求在重试后仍失败")

    async def open_stream(
        self, method: str, path: str, *, csrf: bool = True, **kwargs
    ) -> httpx.Response:
        """打开一个流式响应（SSE 转发用）；调用方负责 aclose。"""
        for attempt in range(2):
            if not self._logged_in:
                await self._login()
            headers = dict(kwargs.pop("headers", None) or {})
            if csrf and method.upper() in _CSRF_METHODS:
                token = self._client.cookies.get("csrf_token")
                if token:
                    headers["X-CSRF-Token"] = token
            req = self._client.build_request(method, path, headers=headers, **kwargs)
            try:
                resp = await self._client.send(req, stream=True)
            except httpx.ConnectError:
                self._logged_in = False
                if attempt == 0:
                    continue
                raise
            if resp.status_code == 401 and self._logged_in:
                self._logged_in = False
                continue
            return resp
        raise DeerFlowError("deerflow 流式请求在重试后仍失败")

    async def aclose(self) -> None:
        await self._client.aclose()
