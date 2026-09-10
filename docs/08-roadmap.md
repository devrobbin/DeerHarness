# 08 · 路线图（Roadmap）

| 项 | 值 |
|---|---|
| **版本** | v1.6.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0011 |
| **变更摘要** | P5/P6 全部收口：模板市场、执行历史 UI、Machines 状态展示 |

## 已完成（Phase 1-8，README 记录）

页面骨架 + Gateway 路由 + Agent Studio + Evolution Lab；Trace 数据流；Dashboard；成本 + Monitor；Settings；WS 实时推送；多用户 + RBAC；Docker Compose 部署。

## 进行中（v0.7.x）

| 项 | 状态 | 说明 |
|---|---|---|
| 产品设计文档体系 | ✅ 落地 | docs/ 全量文档 + 版本链 |
| 融合桥 DeerFlow 2.X 适配（PAT + Idempotency） | ✅ 落地 | deerflow_client / chat / fusion / evolution |
| 成本护栏 token_budget 信号 | ✅ 落地 | `_estimate_run_cost` 识别 token_capped |
| **P1：/runs/wait 完整语义** | ✅ 落地 | wait 优先 + 轮询回退（chat/fusion/evolution） |
| **P1：managed-subagent API 双轨** | ✅ 落地 | `/api/subagents` 优先，config 写入回退 |
| **P1：PAT 最小授权模板** | ✅ 落地 | scope：threads:read / runs:create / runs:read |
| **P2：团队专属评测用例扩充** | ✅ 落地 | 5 团队全覆盖（CS/XB/OPS 新增） |
| **P2：token_budget 进化护栏** | ✅ 落地 | `evolution_token_budget` + token_capped 提前停止 |
| **P2：版本回滚 API + 前端** | ✅ 落地 | `POST /tasks/{id}/rollback` + ScoreChart 按钮 |
| **P3：模板资产化（导入/导出）** | ✅ 落地 | JSON 资产 + 导入/导出 API + Studio UI |
| **P3：通用团队模板** | ✅ 落地 | research-ops / support-ops / dev-ops |
| **P4：定时团队巡检** | ✅ 落地 | DeerFlow Scheduler 接入（cron/interval + 主代理绑定） |
| **P4：官方 Docker 镜像部署文档** | ✅ 落地 | README 部署段（拉官方镜像） |
| **P4：编程式子代理** | ✅ 契约化 | 进程内 API 由 deer-flow 侧承载；Gateway 走 managed-subagent API |
| **P4：Machines** | ✅ 定位更正 | 实为远程部署通道（非评测农场）→ 不做代码接入 |
| **P5：模板版本管理** | ✅ 落地 | 版本号 + 历史归档 + versions API |
| **P5：模板版本回填** | ✅ 落地 | rollback API + Studio 版本面板 |
| **P5：模板来源标记** | ✅ 落地 | 导入 `source` 字段 |
| **P6：定时巡检执行历史** | ✅ 落地 | `GET /team/schedules/{id}/runs` + Studio 历史 UI |
| **P5：模板市场** | ✅ 落地 | 市场索引 + 一键导入副本（source=market:*） |
| **P6：Machines 状态展示** | ✅ 落地 | `GET /api/dashboard/machines` + Monitor 只读区块 |

## 规划（远期）

以下为可选增强，产品主体功能已闭环：

- [ ] 模板共享仓库（跨部署实例的模板分发中心，需服务端基础设施）。
- [ ] 进化任务定时化（用 Scheduler 定期跑进化评估轮）。
- [ ] 团队 run 结果自动进化触发（运行失败/低分自动开进化任务）。

## 版本对应关系

| 代码阶段 | 设计里程碑 |
|---|---|
| v0.7.0 | 产品设计文档体系 v1.0.0 建立 |
| v0.7.x | P1 融合桥 2.X 深度对齐（文档 v1.1.0） |
| v0.7.x | P2 进化增强（文档 v1.2.0） |
| v0.7.x | P3 团队模板资产化（文档 v1.3.0） |
| v0.7.x | P4/P5 上游接入 + 模板生态（文档 v1.4.0） |
| v0.7.x | P5 收尾 + P6 可观测（文档 v1.5.0） |
| v0.7.x | P5/P6 收口：市场 + 执行历史 UI + Machines（文档 v1.6.0） |

## 相关文档

- 愿景：[01-愿景与定位](01-vision.md)
- 契约：[04-融合桥契约](04-fusion-contract.md)
- 版本链：[CHANGELOG](CHANGELOG.md)
