"""可观测性：请求日志中间件 + Prometheus 风格指标（评审遗留 P1-7 / P2-3）。

- 每个请求生成 X-Request-Id，记录 method/path/status/duration
- /metrics 输出 Prometheus 文本格式（零新依赖）
"""

from __future__ import annotations

import logging
import threading
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("deerharness")

# ---------- 指标（内存计数器） ----------
_metrics_lock = threading.Lock()
_requests_total: dict[tuple[str, str], int] = {}  # (method, status) -> count
_duration_total: dict[tuple[str, str], float] = {}  # (method, status) -> seconds
_requests_inflight = 0


def observe_request(method: str, status: int, duration_s: float) -> None:
    global _requests_inflight
    key = (method, str(status))
    with _metrics_lock:
        _requests_total[key] = _requests_total.get(key, 0) + 1
        _duration_total[key] = _duration_total.get(key, 0) + duration_s


def mark_inflight(delta: int) -> None:
    global _requests_inflight
    with _metrics_lock:
        _requests_inflight = max(0, _requests_inflight + delta)


def metrics_text() -> str:
    lines = ["# HELP deerharness_requests_total 请求总数（按方法/状态）",
             "# TYPE deerharness_requests_total counter"]
    with _metrics_lock:
        for (method, status), count in sorted(_requests_total.items()):
            lines.append(
                f'deerharness_requests_total{{method="{method}",status="{status}"}} {count}'
            )
        lines.append("# HELP deerharness_request_duration_seconds 请求累计耗时")
        lines.append("# TYPE deerharness_request_duration_seconds counter")
        for (method, status), dur in sorted(_duration_total.items()):
            lines.append(
                f'deerharness_request_duration_seconds{{method="{method}",status="{status}"}} {dur:.4f}'
            )
        lines.append("# HELP deerharness_requests_inflight 处理中请求数")
        lines.append("# TYPE deerharness_requests_inflight gauge")
        lines.append(f"deerharness_requests_inflight {_requests_inflight}")
    return "\n".join(lines) + "\n"


# ---------- 日志中间件 ----------
class RequestLogMiddleware(BaseHTTPMiddleware):
    """请求日志 + X-Request-Id + 指标采集。"""

    async def dispatch(self, request: Request, call_next):
        request_id = uuid.uuid4().hex[:12]
        request.state.request_id = request_id
        start = time.perf_counter()
        mark_inflight(1)
        try:
            response = await call_next(request)
        except Exception:
            # 异常也记录指标后重新抛出
            duration = time.perf_counter() - start
            observe_request(request.method, 500, duration)
            mark_inflight(-1)
            logger.exception(
                "[%s] %s %s -> 500 (%.3fs)", request_id, request.method, request.url.path
            )
            raise
        duration = time.perf_counter() - start
        observe_request(request.method, response.status_code, duration)
        mark_inflight(-1)
        response.headers["X-Request-Id"] = request_id
        logger.info(
            "[%s] %s %s -> %d (%.3fs)",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            duration,
        )
        return response
