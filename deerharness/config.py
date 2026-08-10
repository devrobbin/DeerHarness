"""配置加载：读取 ``config.yaml``，拆分为三个环节的配置对象。

三个环节对应融合架构的三层：
- Agent Factory（PenguinHarness 服务地址）
- Orchestrator（DeerFlow 运行时与动态加载）
- Data Pipeline（Trace 收集 / 过滤 / 进化 / 灰度）
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


def _env_expand(value: str) -> str:
    """支持 ``${ENV_VAR}`` 占位符，未设置时保留原样。"""
    return os.path.expandvars(value) if isinstance(value, str) else value


@dataclass
class AgentFactoryConfig:
    """PenguinHarness Agent 工厂服务配置。"""

    base_url: str = "http://localhost:8001"
    api_key: Optional[str] = None
    timeout: float = 30.0

    @classmethod
    def from_dict(cls, data: dict) -> "AgentFactoryConfig":
        data = data or {}
        return cls(
            base_url=_env_expand(data.get("base_url", "http://localhost:8001")),
            api_key=_env_expand(data.get("api_key", "") or None),
            timeout=float(data.get("timeout", 30.0)),
        )


@dataclass
class OrchestratorConfig:
    """DeerFlow 编排运行时配置。"""

    base_url: str = "http://localhost:8000"
    dynamic_loader_enabled: bool = True
    canary_percent: float = 10.0  # 灰度流量比例（%）

    @classmethod
    def from_dict(cls, data: dict) -> "OrchestratorConfig":
        data = data or {}
        return cls(
            base_url=_env_expand(data.get("base_url", "http://localhost:8000")),
            dynamic_loader_enabled=bool(data.get("dynamic_loader_enabled", True)),
            canary_percent=float(data.get("canary_percent", 10.0)),
        )


@dataclass
class FilterConfig:
    """反馈过滤器规则：纳入 / 排除条件。"""

    include_rules: list[str] = field(default_factory=list)
    exclude_rules: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "FilterConfig":
        data = data or {}
        return cls(
            include_rules=list(data.get("include", [])),
            exclude_rules=list(data.get("exclude", [])),
        )


@dataclass
class EvolutionConfig:
    """进化预算与触发阈值（避免成本失控）。"""

    min_weekly_executions: int = 1000  # 周执行次数下限
    max_success_rate: float = 0.80  # 成功率低于该值才触发进化
    batch_size: int = 50  # 单批进化样本数

    @classmethod
    def from_dict(cls, data: dict) -> "EvolutionConfig":
        data = data or {}
        return cls(
            min_weekly_executions=int(data.get("min_weekly_executions", 1000)),
            max_success_rate=float(data.get("max_success_rate", 0.80)),
            batch_size=int(data.get("batch_size", 50)),
        )


@dataclass
class CanaryConfig:
    """灰度发布配置。"""

    percent: float = 10.0  # 切到新版的流量比例（%）
    promote_after: int = 100  # 灰度观察样本数
    min_success_rate: float = 0.90  # 灰度成功率达标才全量

    @classmethod
    def from_dict(cls, data: dict) -> "CanaryConfig":
        data = data or {}
        return cls(
            percent=float(data.get("percent", 10.0)),
            promote_after=int(data.get("promote_after", 100)),
            min_success_rate=float(data.get("min_success_rate", 0.90)),
        )


@dataclass
class PipelineConfig:
    """数据闭环管道配置。"""

    filter: FilterConfig = field(default_factory=FilterConfig)
    evolution: EvolutionConfig = field(default_factory=EvolutionConfig)
    canary: CanaryConfig = field(default_factory=CanaryConfig)

    @classmethod
    def from_dict(cls, data: dict) -> "PipelineConfig":
        data = data or {}
        return cls(
            filter=FilterConfig.from_dict(data.get("filter")),
            evolution=EvolutionConfig.from_dict(data.get("evolution")),
            canary=CanaryConfig.from_dict(data.get("canary")),
        )


@dataclass
class Config:
    """DeerHarness 全量配置。"""

    agent_factory: AgentFactoryConfig = field(default_factory=AgentFactoryConfig)
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)

    @classmethod
    def load(cls, path: Optional[str | Path] = None) -> "Config":
        """从 YAML 文件加载配置；未提供路径时使用默认值。"""
        if path is None:
            return cls()
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return cls(
            agent_factory=AgentFactoryConfig.from_dict(raw.get("agent_factory")),
            orchestrator=OrchestratorConfig.from_dict(raw.get("orchestrator")),
            pipeline=PipelineConfig.from_dict(raw.get("pipeline")),
        )
