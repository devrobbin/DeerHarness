# 08 · 路线图（Roadmap）

| 项 | 值 |
|---|---|
| **版本** | v1.3.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0010 |
| **变更摘要** | P3 全部落地：模板资产化（导入/导出）+ 3 个通用团队模板 |

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

## 规划（按优先级）

### P4：上游新能力接入

- [ ] 编程式子代理（`create_deerflow_agent` + `SubagentRuntime`，进程内）——在 deer-flow 侧承载，DeerHarness 作为外部控制面调用。
- [ ] PenguinHarness Machines：评测负载分发到机器农场（多机）。
- [ ] DeerFlow Scheduler：定时团队巡检（契合跨境日常运营巡检场景）。
- [ ] PenguinHarness 官方 Docker 镜像接入部署文档。

### P5：模板生态

- [ ] 模板版本管理（版本号 + 变更历史）。
- [ ] 模板市场 / 共享仓库（导入社区模板）。

## 版本对应关系

| 代码阶段 | 设计里程碑 |
|---|---|
| v0.7.0 | 产品设计文档体系 v1.0.0 建立 |
| v0.7.x | P1 融合桥 2.X 深度对齐（文档 v1.1.0） |
| v0.7.x | P2 进化增强（文档 v1.2.0） |
| v0.7.x | P3 团队模板资产化（文档 v1.3.0） |
| v0.8.0（规划） | P4 上游新能力接入 |

## 相关文档

- 愿景：[01-愿景与定位](01-vision.md)
- 契约：[04-融合桥契约](04-fusion-contract.md)
- 版本链：[CHANGELOG](CHANGELOG.md)
