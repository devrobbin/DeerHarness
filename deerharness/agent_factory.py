"""Agent Factory 客户端（PenguinHarness）。

PenguinHarness 作为独立部署的 Agent 工厂服务，通过标准 HTTP API
输出符合 DeerFlow 子代理规范的 Agent 定义（System Prompt / Tools /
Memory Schema），并支持版本管理与自进化训练。

实际部署时请将 ``base_url`` 指向 PenguinHarness 服务；接口路径
为本项目的约定契约，可按上游实际 API 调整。
"""

from __future__ import annotations

import requests

from .config import AgentFactoryConfig
from .models import AgentSpec, EvolutionJob


class AgentFactoryError(RuntimeError):
    """Agent 工厂服务调用失败。"""


class AgentFactoryClient:
    """PenguinHarness Agent 工厂的 HTTP 客户端。"""

    def __init__(self, config: AgentFactoryConfig) -> None:
        self._config = config
        self._session = requests.Session()
        if config.api_key:
            self._session.headers["Authorization"] = f"Bearer {config.api_key}"

    # -- 版本管理 ----------------------------------------------------------

    def create_agent(self, spec: AgentSpec) -> AgentSpec:
        """在工厂中注册一个新的 Agent 定义。"""
        data = self._request("POST", "/agents", json=self._to_dict(spec))
        return self._from_dict(data)

    def get_agent(self, name: str, version: str = "latest") -> AgentSpec:
        """拉取指定版本的 Agent 定义（默认最新版）。"""
        data = self._request("GET", f"/agents/{name}/versions/{version}")
        return self._from_dict(data)

    def list_versions(self, name: str) -> list[str]:
        """列出某 Agent 的全部版本号。"""
        return self._request("GET", f"/agents/{name}/versions")

    # -- 自进化 ------------------------------------------------------------

    def trigger_evolution(self, job: EvolutionJob) -> str:
        """提交一次进化训练任务，返回任务 ID。

        PenguinHarness 在低峰期自动触发进化训练，产出 N+1 版本，
        经灰度验证后推回 DeerFlow 运行时。
        """
        data = self._request(
            "POST",
            "/evolution/jobs",
            json={
                "agent_name": job.agent_name,
                "base_version": job.base_version,
                "trace_ids": job.trace_ids,
                "target_version": job.target_version,
            },
        )
        return data.get("job_id", job.job_id)

    # -- 工具方法 ----------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs) -> dict:
        url = f"{self._config.base_url.rstrip('/')}{path}"
        kwargs.setdefault("timeout", self._config.timeout)
        try:
            resp = self._session.request(method, url, **kwargs)
            resp.raise_for_status()
        except requests.RequestException as exc:  # 网络错误 / 非 2xx
            raise AgentFactoryError(f"{method} {url} failed: {exc}") from exc
        return resp.json()

    @staticmethod
    def _to_dict(spec: AgentSpec) -> dict:
        return {
            "name": spec.name,
            "version": spec.version,
            "system_prompt": spec.system_prompt,
            "tools": spec.tools,
            "memory_schema": spec.memory_schema,
            "metadata": spec.metadata,
        }

    @staticmethod
    def _from_dict(data: dict) -> AgentSpec:
        return AgentSpec(
            name=data["name"],
            version=data["version"],
            system_prompt=data["system_prompt"],
            tools=data.get("tools", []),
            memory_schema=data.get("memory_schema", {}),
            metadata=data.get("metadata", {}),
        )
