"""PenguinHarness 真实服务客户端：登录会话管理 + 请求代理。

与千问框架假设不同，真实 penguin-harness：
- API 使用 session cookie 认证（POST /api/auth/login，body 为 userId/password）；
- 不存在 /api/agents、/api/evolution/* 顶层端点；
- Agent 位于 /api/projects/:projectId/agents 下，Benchmark 位于
  /api/projects/:projectId/agents/:agentId/benchmarks 下。

本模块负责：登录换取 cookie → 复用会话 → 401（会话过期）时自动重新登录重试一次。
"""

from __future__ import annotations

import asyncio
import os

import httpx

PENGUIN_API = os.environ.get("PENGUIN_API", "http://localhost:7368")
PENGUIN_USER_ID = os.environ.get("PENGUIN_USER_ID", "admin")
# 开发模式（~/.penguin/dev-data）首次启动会种子内置管理员并打印初始密码；
# 生产环境请务必通过 PENGUIN_PASSWORD 注入真实密码。
PENGUIN_PASSWORD = os.environ.get("PENGUIN_PASSWORD", "penguin-3983")


class PenguinError(RuntimeError):
    """PenguinHarness 服务调用失败。"""


class PenguinClient:
    """带自动登录的 penguin-harness HTTP 客户端（单例使用）。"""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=PENGUIN_API, timeout=30.0)
        self._lock = asyncio.Lock()
        self._logged_in = False

    async def _login(self) -> None:
        async with self._lock:
            resp = await self._client.post(
                "/api/auth/login",
                json={"userId": PENGUIN_USER_ID, "password": PENGUIN_PASSWORD},
            )
            if resp.status_code != 200:
                raise PenguinError(
                    f"penguin 登录失败 ({resp.status_code}): {resp.text[:200]}"
                )
            self._logged_in = True

    async def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """发起请求；未登录先登录；401（会话过期）或连接错误时
        强制重新登录后重试一次，避免长驻进程会话陈旧。"""
        for attempt in range(2):
            if not self._logged_in:
                await self._login()
            try:
                resp = await self._client.request(method, path, **kwargs)
            except httpx.ConnectError:
                # 连接失败可能是上游重启/连接池陈旧：重置会话重试一次
                self._logged_in = False
                if attempt == 0:
                    continue
                raise
            if resp.status_code == 401 and self._logged_in:
                self._logged_in = False
                continue
            return resp
        raise PenguinError("penguin 请求在重试后仍失败")

    async def aclose(self) -> None:
        await self._client.aclose()
