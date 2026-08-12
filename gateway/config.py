"""DeerHarness 统一配置：环境变量集中管理，启动 fail-fast。

安全要求（专家评审 P0-3/P1-5）：上游凭据为必填环境变量，无默认值；
缺失时启动即失败，避免默认口令随代码分发。
"""

from __future__ import annotations

import os


class ConfigError(RuntimeError):
    """配置缺失或非法。"""


def _require(name: str, *, default: str | None = None, description: str = "") -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        if default is not None:
            return default
        raise ConfigError(
            f"缺少必需环境变量 {name}（{description}）。"
            f"请参考 .env.example 配置后重启。"
        )
    return value


# ---- 上游服务地址（无默认值 → 启动即校验） ----
PENGUIN_API = _require("PENGUIN_API", description="PenguinHarness 服务地址（如 http://localhost:7368）")
PENGUIN_USER_ID = _require("PENGUIN_USER_ID", default="admin", description="penguin 管理员账号")
PENGUIN_PASSWORD = _require("PENGUIN_PASSWORD", description="penguin 管理员密码（必填，禁止默认口令）")

DEERFLOW_API = _require("DEERFLOW_API", description="DeerFlow 官方栈 nginx 前门（如 http://localhost:2026）")
DEERFLOW_EMAIL = _require("DEERFLOW_EMAIL", description="DeerFlow 管理员邮箱（必填）")
DEERFLOW_PASSWORD = _require("DEERFLOW_PASSWORD", description="DeerFlow 管理员密码（必填，禁止默认口令）")

# ---- 融合配置（宿主机部署时指向 deer-flow 配置与 compose 目录） ----
DEERFLOW_CONFIG = os.environ.get(
    "DEERFLOW_CONFIG", r"D:\ZhiCloud-WorkSpace\deer-flow-run\config.yaml"
)
DEERFLOW_COMPOSE_DIR = os.environ.get(
    "DEERFLOW_COMPOSE_DIR", r"D:\ZhiCloud-WorkSpace\deer-flow"
)

# ---- 平台配置 ----
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3002,http://localhost:3000").split(",")
    if origin.strip()
]
# 管理员初始 API Key：启动时若用户库为空则自动播种
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
# 请求级 LLM 预算（美元）：超限拒绝新对话（安全评审 P1-5）
MAX_COST_PER_REQUEST = float(os.environ.get("MAX_COST_PER_REQUEST", "2.0"))
# 进化评测的评分模型 key（可选；未配置时评测只返回原始回复不评分）
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

# ---- 真实 token 计费（评审 P1-1：按 run 用量计价写入 traces.cost，替代估算） ----
# USD / 1M tokens，可 env 覆盖
MODEL_INPUT_PRICE_PER_M = float(os.environ.get("MODEL_INPUT_PRICE_PER_M", "0.27"))
MODEL_OUTPUT_PRICE_PER_M = float(os.environ.get("MODEL_OUTPUT_PRICE_PER_M", "1.10"))
