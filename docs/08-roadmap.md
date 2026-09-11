# 08 · 路线图（Roadmap）

| 项 | 值 |
|---|---|
| **版本** | v1.7.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0011、ADR-0012 |
| **变更摘要** | 专家评审修订：「进行中」更名已完成；新增验证轨道（产品里程碑）与代码修复待办（评审缺口）；编号体系说明 |

> **编号体系说明**：`Phase 1-8` = 平台建设阶段（根 README 记录）；`P1-P6` = 特性批次代号（下表）。两套代号并行，P 批次已全部收口。

## 已完成（Phase 1-8，平台建设）

页面骨架 + Gateway 路由 + Agent Studio + Evolution Lab；Trace 数据流；Dashboard；成本 + Monitor；Settings；WS 实时推送；多用户 + RBAC；Docker Compose 部署。

## 已完成（P1-P6 特性批次，v0.7.x）

| 项 | 状态 | 说明 |
|---|---|---|
| 产品设计文档体系 | ✅ 落地 | docs/ 全量文档 + 版本链 |
| 融合桥 DeerFlow 2.X 适配（PAT + Idempotency） | ✅ 落地 | deerflow_client / chat / fusion / evolution |
| 成本护栏 token_budget 信号 | ✅ 落地 | `_estimate_run_cost` 识别 token_capped |
| **P1：/runs/wait 完整语义** | ✅ 落地 | wait 优先 + 轮询回退（chat/fusion/evolution）；⚠️ 60s 超时不回退缺口见下 |
| **P1：managed-subagent API 双轨** | ✅ 落地 | `/api/subagents` 优先，config 写入回退；⚠️ 团队 run 主路径未接入见下 |
| **P1：PAT 最小授权模板** | ✅ 落地 | scope：threads:read / runs:create / runs:read |
| **P2：团队专属评测用例扩充** | ✅ 落地 | 跨境 5 团队全覆盖；通用 3 团队待补（见下） |
| **P2：token_budget 进化护栏** | ✅ 落地 | 触顶即停；数值不下发 DeerFlow（语义披露见 docs/05） |
| **P2：版本回滚 API + 前端** | ✅ 落地 | `POST /tasks/{id}/rollback` + ScoreChart 按钮 |
| **P3：模板资产化（导入/导出）** | ✅ 落地 | JSON 资产 + 导入/导出 API + Studio UI |
| **P3：通用团队模板** | ✅ 落地 | research-ops / support-ops / dev-ops（空壳风险披露见 docs/06） |
| **P4：定时团队巡检** | ✅ 落地 | DeerFlow Scheduler 接入；安全考量见 docs/07 |
| **P4：官方 Docker 镜像部署文档** | ✅ 落地 | README 部署段（拉官方镜像） |
| **P4：编程式子代理** | ✅ 契约化 | 进程内 API 由 deer-flow 侧承载 |
| **P4：Machines** | ✅ 定位更正 | 实为远程部署通道 → 只读展示，不做代码接入 |
| **P5：模板版本管理/回填/来源标记** | ✅ 落地 | versions + rollback API + Studio 版本面板 |
| **P5：模板库（一键副本）** | ✅ 落地 | 原名"模板市场"，评审更名（当前仅内置目录） |
| **P6：定时巡检执行历史** | ✅ 落地 | `GET /team/schedules/{id}/runs` + Studio 历史 UI |
| **P6：Machines 状态展示** | ✅ 落地 | `GET /api/dashboard/machines` + Monitor 只读区块 |

## 待办：评审缺口修复（ADR-0012，按风险排序）

5 位专家评审发现的代码级缺口（完整清单见 [07-安全与护栏「已知缺口」](07-safety.md)）：

- [ ] **G4 凭据出库（立即）**：轮换 penguin 管理员密码；`import_crossborder_agents.py` 改环境变量读凭据。
- [ ] **G2/G3 鉴权补齐（立即）**：`/metrics` 挂鉴权；machines 端点挂 admin + 字段白名单。
- [ ] **G1 viewer 只读拦截**：`get_current_user` 层统一 viewer+非GET→403。
- [ ] **G8 wait 超时回退**：`run_and_wait` wait 路径独立超时或纳入回退捕获（进化长评测可用性）。
- [ ] **G7 团队 run 接入双轨**：`_prepare_team` 换调统一入口（消除容器形态团队 run 失败）。
- [ ] **G5 成本护栏统一计量**：middleware 级覆盖非流式/团队运行。
- [ ] **G6 回退轨收窄**：PAT-only 探活修复 + 容器限制文档化（docs/04 已披露）。
- [ ] **G9/G10 定时巡检与模板导入护栏**：频率/成本上限；导入包装+截断。
- [ ] 通用模板专属评测用例（RD/SU/DV 系列）。
- [ ] `max_evolution_rounds` 改 `min(task, safety)` 语义；`evolution_token_budget` 透传或改名。
- [ ] `import_crossborder_agents.py` 之外：验证轮低分提示回滚；start 时无 DEEPSEEK key 拒绝。

## 验证轨道（产品里程碑，与工程并行）

> 工程已闭环，价值闭环需要用户验证（评审 P1-7）：

- **v0.8 目标**：3 个真实跨境卖家试点——跑通"组建团队→真实运行→发起进化→审批→回滚"各 ≥5 次，产出首个**进化前后对比案例**（把 01-vision 价值主张的"待验证"数字填上）。
- **成功指标**见 [01-vision「成功指标」](01-vision.md)。

## 规划（远期）

以下为可选增强，每条标注服务的假设：

- [ ] 模板共享仓库（跨部署实例分发）——验证假设：模板共享需求被 ≥3 个外部实例验证（触发 Non-Goal 重估，见 01-vision）。
- [ ] 进化任务定时化（Scheduler 定期跑进化评估轮）——验证假设：团队需要持续自优化而非按需触发。
- [ ] 团队 run 结果自动进化触发（失败/低分自动开任务）——验证假设：人工发起进化的摩擦是使用瓶颈。
- [ ] 多目标联合改进（bundle proposal）——补全"团队级协同进化"叙事（见 01-vision 诚实边界）。
- [ ] 评测接入真实店铺数据（只读 API）——把跨境场景做深的护城河。

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
