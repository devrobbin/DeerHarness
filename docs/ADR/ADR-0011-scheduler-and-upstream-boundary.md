# ADR-0011 · 定时团队巡检 与 上游能力接入边界

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [04-融合契约](../04-fusion-contract.md)、[06-团队模板](../06-team-templates.md)、[08-路线图](../08-roadmap.md) |

## 背景

路线图 P4 要接入上游新能力。调研上游真实接口后需明确哪些可落地、哪些是误读：

| 上游能力 | 真实定位（源码/文档核实） | 结论 |
|---|---|---|
| **DeerFlow Scheduler** | `POST/GET/PATCH /api/scheduled-tasks` + pause/resume/trigger/delete；支持 `assistant_id`（自定义 agent）、`schedule_type`（once/cron/interval）、`timezone`、`prompt` | ✅ 可接入 → 定时团队巡检 |
| **PenguinHarness Machines** | `GET /api/machines` + `POST /api/machines/:id/install\|connect\|release`；基于服务端 `~/.ssh/config` 把 PenguinHarness **装到另一台机器**（仅管理员） | ⚠️ **是远程部署通道，不是评测计算农场** — 修正原路线图描述 |
| **PenguinHarness 官方 Docker 镜像** | release workflow 发布官方镜像 | ✅ 可接入 → 部署文档 |
| **编程式子代理（create_deerflow_agent + SubagentRuntime）** | 需在 deer-flow **进程内**构造 | ⚠️ 外部控制面（Gateway）无法直接调用 → 契约文档化，标注由 deer-flow 侧承载 |

## 决策

1. **定时团队巡检**：新增 `POST /api/fusion/team/schedule`——用团队模板 + 工作流创建 DeerFlow 定时任务，`assistant_id` 绑定该团队主代理（`dh-orchestrator-<team>`），`prompt` 取工作流 task（含进化覆盖）。配套 `GET /team/schedules`、`POST /team/schedules/{id}/{pause|resume|trigger}`、`DELETE /team/schedules/{id}`。
2. **PAT scope 升级**：定时任务需 `threads:write` + `runs:create`，文档明确该增量授权。
3. **Machines 定位澄清**：它不是"评测负载农场"，而是远程部署通道。本产品**不做代码接入**（超出"编排+进化控制面"定位），仅记录结论。
4. **编程式子代理**：作为契约说明记录，明确边界在 deer-flow 进程内、由 deer-flow 侧承载，Gateway 通过 `POST /api/subagents`（managed-subagent API）间接管理——该路径 P1 已落地。

## 后果

- 定时巡检把"跨境日常运营巡检"从手动升级为自动（cron/interval），是 P4 的主要产品增量。
- 避免为"多机计算农场"这一不存在的能力做无效开发（Machines 误读被纠正）。
- 上游能力接入边界清晰：Gateway 只做 HTTP 可达的能力，进程内 API 交由上游承载。
