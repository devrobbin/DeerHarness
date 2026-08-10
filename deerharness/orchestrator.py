"""Orchestrator 集成层（DeerFlow）。

不修改 DeerFlow 源码，以松耦合方式接入：新增一个
``DynamicAgentLoader`` 节点替代静态子代理配置，运行时按需从
PenguinHarness 工厂拉取最新优化的 Agent，作为"无状态执行单元"
交给 DeerFlow 的沙箱、记忆与状态机基础设施执行。
"""

from __future__ import annotations

from typing import Optional

from .agent_factory import AgentFactoryClient
from .models import AgentSpec
from .pipeline import CanaryRelease


class AgentLoadError(RuntimeError):
    """Agent 动态加载失败（定义缺失 / 不兼容运行时）。"""


class DynamicAgentLoader:
    """DeerFlow 的 DynamicAgentLoader 节点。"""

    def __init__(
        self,
        factory: AgentFactoryClient,
        canary: CanaryRelease,
        default_version: str = "latest",
    ) -> None:
        self._factory = factory
        self._canary = canary
        self._default_version = default_version
        self._cache: dict[tuple[str, str], AgentSpec] = {}

    def load(self, agent_name: str, task_type: str = "") -> AgentSpec:
        """按需加载一个 Agent。

        - 灰度流量（canary）优先加载最新进化版（latest）；
        - 稳定流量（stable）加载当前线上版本（``default_version``）；
        - 命中缓存直接返回，避免每次任务都打工厂 API。
        """
        lane = self._canary.route(agent_name)
        version = "latest" if lane == "canary" else self._default_version
        key = (agent_name, version)
        if key not in self._cache:
            spec = self._factory.get_agent(agent_name, version=version)
            if not spec.is_compatible_with("deerflow"):
                raise AgentLoadError(
                    f"Agent {agent_name}@{version} 与 DeerFlow 运行时规范不兼容"
                )
            self._cache[key] = spec
        return self._cache[key]

    def invalidate(self, agent_name: str) -> None:
        """灰度新版本上线后清空缓存，强制重新拉取。"""
        self._cache = {k: v for k, v in self._cache.items() if k[0] != agent_name}
