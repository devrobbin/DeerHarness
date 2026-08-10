"""数据闭环管道：Trace 收集 → 反馈过滤 → 进化队列 → 灰度发布。

这是融合项目的核心价值点：DeerFlow 的真实执行轨迹驱动
PenguinHarness 的自进化，形成"生产 — 反馈 — 进化 — 灰度"飞轮。
"""

from __future__ import annotations

import random
import threading
from typing import Callable, Optional

from .config import CanaryConfig, EvolutionConfig, FilterConfig
from .models import EvolutionJob, TaskStatus, TraceQuality, TraceRecord

# ---------------------------------------------------------------------------
# 反馈过滤器规则
# ---------------------------------------------------------------------------

_INCLUDE_RULES: dict[str, Callable[[TraceRecord], bool]] = {
    # 任务成功且用户点赞
    "task_success_liked": lambda r: r.status == TaskStatus.SUCCESS
    and r.user_liked is True,
    # 任务失败但根因明确（如工具缺失），可针对性进化
    "failure_root_cause_clear": lambda r: r.status == TaskStatus.FAILED
    and bool(r.root_cause),
    # A/B 测试中胜出组的轨迹
    "ab_test_winner": lambda r: r.metadata.get("ab_winner") is True,
}

_EXCLUDE_RULES: dict[str, Callable[[TraceRecord], bool]] = {
    # 用户恶意操作（如注入类输入导致的失败）
    "malicious": lambda r: r.metadata.get("malicious") is True,
    # 系统级故障（与 Agent 能力无关）
    "system_fault": lambda r: r.root_cause == "system_fault",
    # 隐私敏感数据
    "privacy_sensitive": lambda r: r.metadata.get("privacy_sensitive") is True,
}


class FeedbackFilter:
    """判定一条轨迹是否适合进入进化队列。"""

    def __init__(self, config: FilterConfig) -> None:
        self._include = config.include_rules or list(_INCLUDE_RULES)
        self._exclude = config.exclude_rules or list(_EXCLUDE_RULES)

    def evaluate(self, record: TraceRecord) -> tuple[TraceQuality, list[str]]:
        """返回判定结果与命中的规则列表。"""
        reasons: list[str] = []
        for name in self._exclude:
            rule = _EXCLUDE_RULES.get(name)
            if rule and rule(record):
                reasons.append(f"exclude:{name}")
        if reasons:
            return TraceQuality.EXCLUDE, reasons
        for name in self._include:
            rule = _INCLUDE_RULES.get(name)
            if rule and rule(record):
                reasons.append(f"include:{name}")
                return TraceQuality.INCLUDE, reasons
        reasons.append("no_rule_matched")
        return TraceQuality.EXCLUDE, reasons


class TraceCollector:
    """接收 DeerFlow 上报的执行轨迹（webhook 目标），规范化后入队。

    生产环境可在 FastAPI/Flask 中挂载本类，将收到的事件转为
    ``TraceRecord`` 后调用 :meth:`ingest`。
    """

    def __init__(self, filter_: FeedbackFilter) -> None:
        self._filter = filter_
        self.ingested: int = 0
        self.accepted: int = 0

    def ingest(self, record: TraceRecord) -> tuple[TraceQuality, list[str]]:
        """接收一条轨迹：过滤并（若通过）追加到进化队列。"""
        quality, reasons = self._filter.evaluate(record)
        self.ingested += 1
        if quality == TraceQuality.INCLUDE:
            self.accepted += 1
            self._on_accepted(record)
        return quality, reasons

    def _on_accepted(self, record: TraceRecord) -> None:
        """子类可覆写：把通过过滤的轨迹写入持久化存储 / 外部队列。"""
        raise NotImplementedError


class EvolutionQueue:
    """进化队列：满足触发阈值（成本预算）后产出进化批次。"""

    def __init__(self, config: EvolutionConfig) -> None:
        self._config = config
        self._records: list[TraceRecord] = []
        self._lock = threading.Lock()
        self._stats: dict[str, int] = {}  # agent_name -> 累计执行次数

    def push(self, record: TraceRecord) -> None:
        with self._lock:
            self._records.append(record)
            self._stats[record.agent_name] = self._stats.get(record.agent_name, 0) + 1

    def ready_batches(self) -> list[list[TraceRecord]]:
        """返回满足进化预算条件的批次。

        触发条件（避免成本失控，与避坑指南一致）：
        某类任务周执行次数 >= 阈值 且 成功率低于阈值。
        """
        with self._lock:
            batches: list[list[TraceRecord]] = []
            for name, total in self._stats.items():
                if total < self._config.min_weekly_executions:
                    continue
                success = sum(
                    1
                    for r in self._records
                    if r.agent_name == name and r.status == TaskStatus.SUCCESS
                )
                success_rate = success / total
                if success_rate >= self._config.max_success_rate:
                    continue  # 效果够好，暂不进化
                batch = [r for r in self._records if r.agent_name == name]
                batches.append(batch[: self._config.batch_size])
            return batches


class CanaryRelease:
    """灰度发布：新版 Agent 先切小流量，指标达标后全量。"""

    def __init__(self, config: CanaryConfig) -> None:
        self._config = config
        self._observed: int = 0
        self._successes: int = 0
        self._promoted: bool = False

    def route(self, agent_name: str) -> str:
        """按百分比决定本次请求走 canary（最新进化版）还是 stable。

        生产环境可换成一致性哈希等无状态路由；此处用简单随机采样。
        """
        if self._promoted:
            return "stable"  # 已全量：canary 版本即 stable
        return "canary" if random.random() < self._config.percent / 100.0 else "stable"

    def observe(self, success: bool) -> None:
        """记录一次灰度观察样本。"""
        self._observed += 1
        if success:
            self._successes += 1

    def should_promote(self) -> bool:
        """灰度样本足够且成功率达标时建议全量。"""
        if self._promoted or self._observed < self._config.promote_after:
            return False
        rate = self._successes / self._observed
        return rate >= self._config.min_success_rate

    def promote(self) -> None:
        """全量发布新版。"""
        self._promoted = True

    @property
    def promoted(self) -> bool:
        return self._promoted


def build_evolution_job(
    agent_name: str, base_version: str, batch: list[TraceRecord]
) -> EvolutionJob:
    """把一批轨迹打包成一次进化任务（组合版本策略的基础单元）。"""
    import uuid

    return EvolutionJob(
        job_id=str(uuid.uuid4()),
        agent_name=agent_name,
        base_version=base_version,
        trace_ids=[r.trace_id for r in batch],
        target_version=f"{base_version}.N+1",
    )
