"""DeerFlow 官方栈客户端：PAT（2.X 主推）优先，OAuth2 表单登录回退。

认证契约（DeerFlow 2.X 基准）：
- 首选：`DEERFLOW_PAT`（Personal Access Token）→ `Authorization: Bearer <token>`
  带权限作用域（threads:read / runs:create / runs:read / runs:cancel…），
  由 DeerHarness Gateway 单点持有，避免共享管理员账号。
- 回退：`DEERFLOW_EMAIL` + `DEERFLOW_PASSWORD` 走 OAuth2 表单登录
  （POST /api/v1/auth/login/local → 会话 cookie + csrf_token cookie），
  状态变更请求带 X-CSRF-Token（双提交 cookie 值）。兼容老部署。

与 penguin_client 同理：trust_env=False 直连（避免本机系统代理拦截回环）。
"""

from __future__ import annotations

import asyncio

import httpx

import config

DEERFLOW_API = config.DEERFLOW_API
DEERFLOW_PAT = config.DEERFLOW_PAT
DEERFLOW_EMAIL = config.DEERFLOW_EMAIL
DEERFLOW_PASSWORD = config.DEERFLOW_PASSWORD

_CSRF_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class DeerFlowError(RuntimeError):
    """DeerFlow 服务调用失败。"""


class DeerFlowClient:
    """DeerFlow 官方栈客户端（单例使用）。

    PAT 模式下无需登录/CSRF；OAuth2 回退模式下自动登录并注入 CSRF 头。
    401（会话过期）或连接错误时重新登录重试一次。
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=DEERFLOW_API, timeout=60.0, trust_env=False)
        self._lock = asyncio.Lock()
        self._logged_in = False
        self._pat_mode = bool(DEERFLOW_PAT)

    def _auth_headers(self) -> dict:
        if self._pat_mode:
            return {"Authorization": f"Bearer {DEERFLOW_PAT}"}
        return {}

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
        """发起请求；PAT 头或自动登录 + CSRF；401/连接错误时重新认证重试一次。"""
        for attempt in range(2):
            headers = dict(kwargs.pop("headers", None) or {})
            headers.update(self._auth_headers())
            if not self._pat_mode:
                if not self._logged_in:
                    await self._login()
                if csrf and method.upper() in _CSRF_METHODS:
                    token = self._client.cookies.get("csrf_token")
                    if token:
                        headers["X-CSRF-Token"] = token
            try:
                resp = await self._client.request(method, path, headers=headers, **kwargs)
            except httpx.ConnectError:
                if not self._pat_mode:
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
            headers = dict(kwargs.pop("headers", None) or {})
            headers.update(self._auth_headers())
            if not self._pat_mode:
                if not self._logged_in:
                    await self._login()
                if csrf and method.upper() in _CSRF_METHODS:
                    token = self._client.cookies.get("csrf_token")
                    if token:
                        headers["X-CSRF-Token"] = token
            req = self._client.build_request(method, path, headers=headers, **kwargs)
            try:
                resp = await self._client.send(req, stream=True)
            except httpx.ConnectError:
                if not self._pat_mode:
                    self._logged_in = False
                    if attempt == 0:
                        continue
                raise
            if resp.status_code == 401 and self._logged_in:
                self._logged_in = False
                continue
            return resp
        raise DeerFlowError("deerflow 流式请求在重试后仍失败")

    async def run_and_wait(
        self,
        thread_id: str,
        *,
        body: dict,
        idempotency_key: str,
        poll_interval: float = 2.0,
        poll_timeout: float = 240.0,
    ) -> dict:
        """DeerFlow 2.X：创建 run 并阻塞到终态（/runs/wait 优先，轮询回退）。

        - 首选 POST /api/threads/{id}/runs/wait（同 Create Run body + Idempotency-Key）
          → 完成时返回 final state（含 messages），可提取 AI 回复。
        - 该端点不可用（旧版 / 405 / 409 store-only 无法跨进程观察）时回退
          POST /api/threads/{id}/runs + GET /runs/{run_id} 轮询。
        - 幂等键保证超时/重试不重复执行同一逻辑请求（2.X 语义）。

        返回 {"state": dict|None, "status": str, "run_id": str|None}。
        """
        wait_path = f"/api/threads/{thread_id}/runs/wait"
        headers = {"Idempotency-Key": idempotency_key}
        try:
            resp = await self.request("POST", wait_path, json=body, headers=headers)
        except (DeerFlowError, httpx.ConnectError):
            resp = None
        if resp is not None and resp.status_code == 200:
            data = resp.json()
            # /runs/wait 完成 → final state（含 messages）；store-back 覆盖 → status/error
            if isinstance(data, dict) and data.get("messages") is not None:
                return {"state": data, "status": data.get("status", "success"), "run_id": data.get("run_id")}
            if isinstance(data, dict) and data.get("status"):
                # 终态（success/failed/error/cancelled）直接返回；仍运行中才回退轮询
                if data["status"] not in ("pending", "running", "queued"):
                    return {"state": None, "status": data["status"], "run_id": data.get("run_id")}
            # 其余情况（空 state / 未知形态）→ 回退轮询
        # 回退：创建 + 轮询（兼容旧版无 /runs/wait）
        resp = await self.request(
            "POST", f"/api/threads/{thread_id}/runs", json=body, headers=headers
        )
        if resp.status_code >= 400:
            raise DeerFlowError(f"deerflow 创建 run 失败 ({resp.status_code}): {resp.text[:200]}")
        run = resp.json()
        run_id = run.get("run_id")
        import time as _time

        deadline = _time.monotonic() + poll_timeout
        status = run.get("status", "pending")
        detail: dict = run
        while status in ("pending", "running", "queued"):
            if _time.monotonic() > deadline:
                raise DeerFlowError("deerflow run 等待超时")
            await asyncio.sleep(poll_interval)
            resp = await self.request("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            if resp.status_code >= 400:
                raise DeerFlowError(f"deerflow 轮询 run 失败 ({resp.status_code}): {resp.text[:200]}")
            detail = resp.json()
            status = detail.get("status", status)
        return {"state": None, "status": status, "run_id": run_id, "_detail": detail}

    async def aclose(self) -> None:
        await self._client.aclose()
