"""DeerHarness 核心数据模型。

定义融合架构中三个核心环节的数据契约:

- ``AgentSpec``: PenguinHarness 产出的 Agent 定义（System Prompt / Tools / Memory Schema），
  即 DeerFlow 子代理规范要求的"无状态执行单元"。
- ``TraceRecord``: DeerFlow 的一条执行轨迹，是自进化数据闭环的原材料。
- ``EvolutionJob``: 交给 PenguinHarness 的一次进化训练任务。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class TaskStatus(str, Enum):
    """任务执行状态（DeerFlow 上报）。"""

    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class TraceQuality(str, Enum):
    """反馈过滤器对轨迹的判定结果。"""

    INCLUDE = "include"  # 适合进入进化队列
    EXCLUDE = "exclude"  # 不适合用于进化


@dataclass
class AgentSpec:
    """PenguinHarness 产出的 Agent 定义。

    对应融合架构中的"无状态执行单元"：只携带定义本身，
    沙箱、记忆、任务状态机等基础设施由 DeerFlow 提供。
    """

    name: str
    version: str
    system_prompt: str
    tools: list[str] = field(default_factory=list)
    memory_schema: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_compatible_with(self, runtime: str = "deerflow") -> bool:
        """校验 Agent 定义是否满足 DeerFlow 子代理规范（占位实现）。"""
        if not self.system_prompt.strip():
            return False
        return self.metadata.get("runtime", runtime) == runtime


@dataclass
class TraceRecord:
    """一条 DeerFlow 执行轨迹。

    关键记录字段（与融合方案一致）：任务目标、工具调用链、最终产出、
    用户反馈/自动评估分数；以及供反馈过滤器使用的失败根因等信号。
    """

    trace_id: str
    task_id: str
    agent_name: str
    agent_version: str
    task_goal: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    output: str = ""
    status: TaskStatus = TaskStatus.RUNNING
    score: Optional[float] = None  # 自动评估分数 0~1
    user_liked: Optional[bool] = None  # 用户是否点赞
    root_cause: Optional[str] = None  # 失败根因，如 tool_missing
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class EvolutionJob:
    """一次交给 PenguinHarness 的进化训练任务。"""

    job_id: str
    agent_name: str
    base_version: str
    trace_ids: list[str] = field(default_factory=list)
    target_version: str = ""
    status: str = "queued"
    created_at: datetime = field(default_factory=datetime.utcnow)
