"""DeerHarness 入口。

用法：
    python main.py demo                  # 离线演示数据闭环（不访问任何外部服务）
    python main.py demo --config path    # 加载真实配置（演示仍使用小阈值）
"""

from __future__ import annotations

import argparse
import sys

from deerharness.agent_factory import AgentFactoryClient
from deerharness.config import (
    CanaryConfig,
    Config,
    EvolutionConfig,
    FilterConfig,
    PipelineConfig,
)
from deerharness.models import AgentSpec, TaskStatus, TraceRecord
from deerharness.orchestrator import DynamicAgentLoader
from deerharness.pipeline import (
    CanaryRelease,
    EvolutionQueue,
    FeedbackFilter,
    TraceCollector,
    build_evolution_job,
)


class DemoCollector(TraceCollector):
    """把通过过滤的轨迹写入进化队列（生产环境应接持久化存储）。"""

    def __init__(self, filter_: FeedbackFilter, queue: EvolutionQueue) -> None:
        super().__init__(filter_)
        self._queue = queue

    def _on_accepted(self, record: TraceRecord) -> None:
        self._queue.push(record)


class FakeAgentFactory:
    """离线演示用的工厂桩：仅实现 :class:`AgentFactoryClient` 的子集。"""

    def __init__(self) -> None:
        self._agents = {
            ("demo-agent", "latest"): AgentSpec(
                name="demo-agent",
                version="v1.2.0",
                system_prompt="你是工单摘要助手，输出三段式摘要。",
                tools=["web_search", "summarize"],
                metadata={"runtime": "deerflow"},
            ),
            ("demo-agent", "v1.0.0"): AgentSpec(
                name="demo-agent",
                version="v1.0.0",
                system_prompt="你是工单摘要助手。",
                tools=["summarize"],
                metadata={"runtime": "deerflow"},
            ),
        }

    def get_agent(self, name: str, version: str = "latest") -> AgentSpec:
        key = (name, version)
        if key not in self._agents:
            raise RuntimeError(f"no such agent {name}@{version}")
        return self._agents[key]


def demo_config() -> Config:
    """演示用小阈值配置，让过滤 / 进化 / 灰度逻辑在几秒内可见。"""
    return Config(
        pipeline=PipelineConfig(
            filter=FilterConfig(),
            evolution=EvolutionConfig(
                min_weekly_executions=20, max_success_rate=0.8, batch_size=5
            ),
            canary=CanaryConfig(percent=30.0, promote_after=10, min_success_rate=0.9),
        )
    )


def run_demo(config: Config) -> None:
    print("=" * 60)
    print("DeerHarness 数据闭环演示（离线）")
    print(f"  Agent Factory : {config.agent_factory.base_url}")
    print(f"  Orchestrator  : {config.orchestrator.base_url}")
    print("=" * 60)

    filter_ = FeedbackFilter(config.pipeline.filter)
    queue = EvolutionQueue(config.pipeline.evolution)
    collector = DemoCollector(filter_, queue)
    canary = CanaryRelease(config.pipeline.canary)
    loader = DynamicAgentLoader(FakeAgentFactory(), canary, default_version="v1.0.0")

    # 1) 反馈过滤：模拟 DeerFlow 上报的各类轨迹
    print("\n[1] Trace 收集与反馈过滤")
    samples = [
        TraceRecord("t-1", "task-1", "demo-agent", "v1.0.0", "摘要工单#1001",
                    status=TaskStatus.SUCCESS, user_liked=True, score=0.95),
        TraceRecord("t-2", "task-2", "demo-agent", "v1.0.0", "摘要工单#1002",
                    status=TaskStatus.FAILED, root_cause="tool_missing"),
        TraceRecord("t-3", "task-3", "demo-agent", "v1.0.0", "摘要工单#1003",
                    status=TaskStatus.FAILED, root_cause="system_fault"),
        TraceRecord("t-4", "task-4", "demo-agent", "v1.0.0", "摘要工单#1004",
                    status=TaskStatus.SUCCESS, user_liked=None, score=0.5),
        TraceRecord("t-5", "task-5", "demo-agent", "v1.0.0", "摘要工单#1005",
                    status=TaskStatus.SUCCESS, user_liked=True, score=0.90,
                    metadata={"ab_winner": True}),
    ]
    for trace in samples:
        quality, reasons = collector.ingest(trace)
        print(f"  {trace.trace_id} -> {quality.value:8s} ({', '.join(reasons)})")

    # 2) 动态加载：灰度 / 稳定分流拉取不同版本
    print("\n[2] DynamicAgentLoader 按需拉取")
    for _ in range(6):
        spec = loader.load("demo-agent")
        lane = "canary" if spec.version == "v1.2.0" else "stable"
        print(f"  load demo-agent -> {spec.version} ({lane})")

    # 3) 进化触发：造出足够的低成功率执行记录
    print("\n[3] 进化队列（成功率 < 80% 且执行次数达标才触发）")
    for i in range(60):
        success = i % 3 != 0  # 成功率约 66%
        collector.ingest(
            TraceRecord(
                f"t-bulk-{i}", f"task-bulk-{i}", "demo-agent", "v1.0.0",
                f"批量任务 #{i}",
                status=TaskStatus.SUCCESS if success else TaskStatus.FAILED,
                user_liked=True if success else None,
                root_cause=None if success else "tool_missing",
            )
        )
    for batch in queue.ready_batches():
        job = build_evolution_job("demo-agent", "v1.0.0", batch)
        print(f"  job={job.job_id[:8]} agent={job.agent_name} "
              f"traces={len(job.trace_ids)} target={job.target_version}")

    # 4) 灰度观察与全量发布
    print("\n[4] 灰度发布")
    for _ in range(config.pipeline.canary.promote_after):
        canary.observe(success=True)
    if canary.should_promote():
        canary.promote()
        print(f"  promote -> 新版已全量 (promoted={canary.promoted})")
    else:
        print("  keep canary (promoted=False)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="deerharness", description="DeerHarness 融合项目")
    parser.add_argument("command", choices=["demo"], help="demo: 离线演示数据闭环")
    parser.add_argument("--config", default=None, help="配置文件路径（如 config.example.yaml）")
    args = parser.parse_args(argv)

    config = Config.load(args.config)
    if args.config:
        print(f"已加载配置: {args.config}")
    run_demo(demo_config())
    return 0


if __name__ == "__main__":
    sys.exit(main())
