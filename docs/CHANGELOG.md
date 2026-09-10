# DeerHarness 版本链 · CHANGELOG

> **这是版本链主日志。** 每次需求 / 功能 / 架构变更，必须在顶部插入一条记录；重要决策同步到 `docs/ADR/`。
>
> 格式：`日期 | 版本 | 变更 | 影响的文档（版本） | ADR`
> 版本语义（文档层）：major=架构级破坏 / minor=功能级 / patch=说明澄清。详见 [docs/README.md](./README.md#版本语义)。

---

## 2026-09-10 · v1.2.0 · 路线图 P2：进化能力增强

**变更摘要**
- **P2-1 团队专属评测用例扩充**：`_BUILTIN_BENCHMARKS` 新增 5 个团队专属用例（CS-001 短视频脚本、CS-002 商品页文案、XB-001 日常巡检、OPS-001 物流方案、OPS-002 退税核算）；`_TEAM_CASES` 全部 5 团队均有专属用例（含 amazon-ops 补 AMZ-002-acos）。
- **P2-2 token_budget 成本护栏**：安全设置新增 `evolution_token_budget`（DeerFlow 2.X 子代理 token 硬顶，可选）；`run_and_wait` 透传 `subagent_stop_reason`；`_run_case`/`_run_team_case` 在触发 `token_capped` 时返回 `token_capped` 状态；进化单轮任一 case 触顶即提前停止，避免截断结果误判达标。
- **P2-3 版本回滚**：`evolution_store.py` 新增 `override_history` 表 + `set_override` 记录旧值 + `get_override_before_version`/`delete_override`；`POST /api/evolution/tasks/{id}/rollback`（admin，恢复目标版本前值或回退基础模板）；前端 ScoreChart 每版本行加"回滚"按钮。新增 4 项单测（`test_evolution_store.py`）。

**影响的文档**
- [05-进化引擎](05-evolution.md) v1.1.0
- [06-团队模板](06-team-templates.md) v1.1.0
- [07-安全与护栏](07-safety.md) v1.2.0
- [08-路线图](08-roadmap.md) v1.2.0

**ADR**
- [ADR-0009 版本回滚](./ADR/ADR-0009-rollback.md)

---

## 2026-09-10 · v1.1.0 · 路线图 P1：融合桥 2.X 深度对齐

**变更摘要**
- **P1-1 `/runs/wait` 完整语义**：`deerflow_client.run_and_wait()` 统一封装，非流式场景 POST `/runs/wait` 优先（同 Create Run body + Idempotency-Key），端点不可用时回退 POST `/runs` + 轮询。chat / fusion 评测 / 进化团队评测全部接入（`gateway/deerflow_client.py`、`routes/chat.py`、`routes/fusion.py`、`routes/evolution.py`）。
- **P1-2 子代理同步双轨**：`fusion.sync_subagents()` 统一入口——优先 `GET/POST/PUT /api/subagents`（managed-subagent HTTP API，无需改 config / 无需重启）；API 不可用时回退 `_write_subagents_config`（config.yaml 原子写 + 重启）。团队 sync 与进化目标解析均走双轨。
- **P1-3 PAT 最小授权模板**：scope 明确为 `threads:read` + `runs:create` + `runs:read`（`runs:cancel` / `threads:write` / `threads:delete` 按需追加）；README 补充 PAT 申请步骤（`POST /api/v1/auth/pats`）；`.env.example` 注释修正。

**影响的文档**
- [03-系统架构](03-architecture.md) v1.1.0
- [04-融合桥契约](04-fusion-contract.md) v1.1.0
- [07-安全与护栏](07-safety.md) v1.1.0
- [08-路线图](08-roadmap.md) v1.1.0

**ADR**
- [ADR-0008 /runs/wait 与 managed-subagent API 双轨](./ADR/ADR-0008-wait-subagent-api.md)

---

## 2026-09-10 · v1.0.0 · 产品设计文档体系建立 + 融合桥 2.X 适配

**变更摘要**
- 建立完整产品设计文档体系（docs/ 9 篇 + ADR），明确 **DeerFlow 2.X 为既定基准**。
- 融合桥 DeerFlow 2.X 适配：`DEERFLOW_PAT`（Bearer Token）优先认证，email/password OAuth2 仅作老部署兼容回退（`gateway/config.py`、`gateway/deerflow_client.py`、`.env.example`）。
- 运行调用附 **Idempotency-Key**（`dh-eval-*` / `dh-evolve-*` / `dh-chat-*`），对齐 2.X 幂等 run 语义（`routes/fusion.py`、`routes/evolution.py`、`routes/chat.py`）。
- 成本护栏识别 DeerFlow 2.X `subagent_stop_reason=token_capped` 信号 + `total_tokens` 回退（`routes/fusion.py::_estimate_run_cost`）。
- 开启版本链管理：CHANGELOG + ADR + 文档版本头，变更强制双写规范。

**影响的文档**
- [01-愿景与定位](01-vision.md) v1.0.0
- [02-产品设计](02-product.md) v1.0.0
- [03-系统架构](03-architecture.md) v1.0.0
- [04-融合桥契约](04-fusion-contract.md) v1.0.0
- [05-进化引擎](05-evolution.md) v1.0.0
- [06-团队模板](06-team-templates.md) v1.0.0
- [07-安全与护栏](07-safety.md) v1.0.0
- [08-路线图](08-roadmap.md) v1.0.0

**ADR**
- [ADR-0001 产品定位](./ADR/ADR-0001-product-positioning.md)
- [ADR-0002 文档版本链与变更规范](./ADR/ADR-0002-doc-versioning.md)
- [ADR-0003 DeerFlow 2.X 为基准](./ADR/ADR-0003-deerflow-2x-baseline.md)
- [ADR-0004 PAT 认证与 Idempotency](./ADR/ADR-0004-pat-idempotency.md)
- [ADR-0005 进化闭环设计](./ADR/ADR-0005-evolution-loop.md)
- [ADR-0006 团队模板资产](./ADR/ADR-0006-team-templates.md)
- [ADR-0007 安全模型](./ADR/ADR-0007-security-model.md)

---

<!-- 历史记录在 ADR/CHANGELOG 建立前不追溯；从 v1.0.0 起版本链正式生效。 -->
