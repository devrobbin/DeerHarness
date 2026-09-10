# ADR-0005 · 进化闭环设计

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [05-进化引擎](../05-evolution.md) |

## 背景

早期进化生命周期是空壳（start/status/versions 全 501）。需把"评估机制"与"进化生命周期"接通，并保证 AI 自我改进可控。

## 决策

**三层进化目标 + 闭环 + 审批门 + 护栏**：

- 目标：agent / workflow（进化 task 模板）/ team（进化 soul + member_prompt）。
- 闭环：评估 → LLM 改进建议 → 审批门 → 应用 → 复测（逐轮后台推进）。
- 审批门：`require_human_approval=true` 时方案入队列，approve/reject 后继续；**验证轮**保证改进被评测。
- 负样本记忆：reject 的 reason 摘要阻止下一轮原样再提。
- 产物写入 `config_overrides`，"基础模板 + 覆盖"合并，可追溯可回滚。
- 护栏：max_rounds / max_cost / blocked_domains。

## 后果

- 进化从"空壳"变为可用闭环（2026-09-10 落地）。
- 人工审批是默认；自动模式可关。
- 进化产物立即被团队编排使用（融合合并逻辑）。
