# DeerHarness 版本链 · CHANGELOG

> **这是版本链主日志。** 每次需求 / 功能 / 架构变更，必须在顶部插入一条记录；重要决策同步到 `docs/ADR/`。
>
> 格式：`日期 | 版本 | 变更 | 影响的文档（版本） | ADR`
> 版本语义（文档层）：major=架构级破坏 / minor=功能级 / patch=说明澄清。详见 [docs/README.md](./README.md#版本语义)。

---

## 2026-09-11 · v1.7.2 · 评审缺口收口（G9/G10/G5 余项）

**变更摘要**
- **G9 定时巡检护栏**：创建前 `_schedule_guardrails`——全局数量上限 20；频率下限（interval ≥1h，cron 解析最小间隔 ≥1h，`*/N` 分钟步进如实计价）；`blocked_domains` 过滤 prompt（与进化同一禁入领域配置）；prompt 长度上限 8000 字符。新增 `_cron_min_interval_minutes` 粗粒度解析器。
- **G10 模板导入供应链**：导入 soul 截断至 `_MAX_PROMPT_CHARS`（8000）+ 来源声明包装（含 source 标记），与 penguin 同步路径同等防护；模板测试断言适配包装语义。
- **G5 余项预算覆盖**：`_under_chat_budget` 支持按轨迹前缀计量（dh-chat / dh-fusion / dh-eval / dh-team），非流式 chat、fusion chat、team run、team start 全部接入预算检查——请求级预算不再被绕过。
- **单测**：新增 `test_guardrails.py`（12 项：cron 解析 4 / 巡检护栏 5 / 供应链 2 + 模板适配），总计 76 项。

**影响的文档**
- [07-安全与护栏](07-safety.md) v1.5.0（缺口 G1-G10 全部闭环，G4 留运维轮换动作）

---

## 2026-09-11 · v1.7.1 · 评审缺口代码修复（G1-G8）

**变更摘要**
- **G1 viewer 只读拦截**：`auth.get_current_user` 注入 Request，viewer + 非 GET/HEAD/OPTIONS → 403（新 `_viewer_write_blocked` 可测函数，4 项单测）——"viewer：只读"承诺与实现一致。
- **G2 `/metrics` 挂鉴权**：`require_admin`（指标含路径/状态码/耗时分布等内部信息）。
- **G3 machines 挂 admin**：`GET /api/dashboard/machines` 与上游"仅管理员"对齐（含内网 SSH 主机清单）。
- **G4 凭据出库**：`import_crossborder_agents.py` 改环境变量读凭据（PENGUIN_PASSWORD 必填缺失报错）；⚠️ **运维待办：轮换 penguin 管理员密码**（旧密码已在 git 历史）。
- **G5 max_rounds min 语义**：进化轮次上限 = min(请求参数, Settings 硬上限)——修复 Settings 值被请求参数短路而永不生效。
- **G6 探活自适应**：`_wait_deerflow_ready` 按认证模式选择探活（PAT → Bearer GET /api/agents；OAuth2 → 登录探活），PAT-only 部署不再误报 503。
- **G7 团队 run 接入双轨**：`_prepare_team` 改调 `sync_subagents` 统一入口（原直调 config 写入 + docker restart，容器形态必失败且杀并发 run）。
- **G8 wait 超时回退**：`run_and_wait` 的 wait 路径用独立长超时（poll_timeout+30s），`TimeoutException` 纳入回退捕获——修复超 60s 长任务 ReadTimeout 穿透导致进化长评测系统性失败。
- **单测**：新增 `test_security_fixes.py`（viewer 拦截 4 项），总计 64 项。

**影响的文档**
- [07-安全与护栏](07-safety.md) v1.4.0（缺口状态更新：G1-G8 ✅，G4 遗留运维动作，G9/G10 待办）

---

## 2026-09-11 · v1.7.0 · 专家评审与文档-实现对齐

**变更摘要**
- **评审**：5 位专家（产品战略 / 系统架构 / 安全合规×2 / 文档工程 / 开发者体验）并行评审全部文档并核对代码事实，产出 P0×7 / P1×约22 / P2×约40（多位专家独立命中同一批问题，交叉验证）。
- **产品叙事对齐**（01）："团队级协同进化"→"以团队真实运行为评测单元的协同进化"（每轮改进实为单点方案）；"业务目标分"→"质量目标分"+评分边界披露；新增竞争格局表（vs LangGraph/AutoGen/Dify/裸用 DeerFlow）、成功指标（北极星+验证轨道）、VP 证据栏；目标用户分主次；Non-Goals 改为"初始不做+重估触发条件"。
- **任务层补齐**（新增 09-guides）：5 分钟上手 + PAT/模板/巡检 3 个 how-to + troubleshooting（13 项）+ 二次开发指引；根 README 减负（核心概念表、前置条件、鉴权说明、API 表补充、Phase 表精简、PAT scope 改引用）。
- **SSOT 消重**：PAT scope 主场 07、护栏配置主场 05、模板/巡检 API 主场 06、API 运行时真相源 = OpenAPI `/docs`；修复 04 与 07 的 scope 定义矛盾。
- **安全如实披露**（07）：权限矩阵重写（viewer 无守卫为已知缺口 G1）；新增「已知缺口 G1-G10」（/metrics 无鉴权、machines 降权、种子密码入库、成本护栏绕过、回退轨限制、团队 run 未接双轨、wait 超时不回退、巡检/导入供应链风险）、「信息泄露面」「定时巡检」「模板供应链」节。
- **架构文档对齐**（03/04）：部署口径修正（两服务编排）；存储路径修正（根 config/ = DB，gateway/config/ = 配置资产）；新增「限制与风险」（单进程内存态/SQLite 单写者/重启杀 run/成本轮首检查）与「扩展性路径」；补 openapi_factory 组件；私有实现符号改行为语义；修复端点路径/白名单表述/scope/状态矛盾（A1-A3）。
- **进化引擎披露**（05）：max_rounds 永不生效、token_budget 本地开关语义、验证轮不看分数、DEEPSEEK 依赖、通用模板无专属用例——全部如实标注。
- **机制增强**（docs/README）：词汇表（16 词）、SSOT 规则、ADR 索引+supersede 约定、角色化阅读路径、文档类型标注。

**影响的文档**
- [01-愿景与定位](01-vision.md) v1.1.0
- [02-产品设计](02-product.md) v1.1.0
- [03-系统架构](03-architecture.md) v1.2.0
- [04-融合桥契约](04-fusion-contract.md) v1.5.0
- [05-进化引擎](05-evolution.md) v1.2.0
- [06-团队模板](06-team-templates.md) v1.5.0
- [07-安全与护栏](07-safety.md) v1.3.0
- [08-路线图](08-roadmap.md) v1.7.0
- [09-上手指南](09-guides.md) v1.0.0（新增）
- [docs/README](README.md)（地图/词汇表/SSOT/ADR 索引）
- 根 README（快速开始修正/核心概念/API 表/Phase 精简）

**ADR**
- [ADR-0012 专家评审与文档-实现对齐](./ADR/ADR-0012-expert-review.md)

---

## 2026-09-10 · v1.6.0 · P5/P6 收口：模板市场 + 执行历史 UI + Machines 状态

**变更摘要**
- **模板市场**：`GET /api/fusion/team/templates/market` 返回内置模板可导入资产目录（`installed` 标记已有副本）；Studio「🛒 市场」面板一键"导入副本"（默认 `<name>-copy`，`source` 记 `market:<原模板>`）。
- **定时巡检执行历史 UI**：Studio 定时巡检面板加载定时任务列表（状态/标题），支持 立即跑 / 暂停 / 恢复 / 删除 / 查看执行历史（runs 列表）。
- **Machines 状态展示**：`GET /api/dashboard/machines` 只读代理上游 `GET /api/machines`（上游不可达时降级空列表）；Monitor 健康面板加 Machines 只读区块（可安装版本 + 已安装主机）。
- **前端**：TeamOrchestrator 引入 `apiDelete`；monitor 页加 machines 状态。

**影响的文档**
- [06-团队模板](06-team-templates.md) v1.5.0
- [08-路线图](08-roadmap.md) v1.6.0

---

## 2026-09-10 · v1.5.0 · P5 收尾 + P6 可观测

**变更摘要**
- **P5 模板版本回填**：`fusion.py` 新增 `POST /api/fusion/team/templates/{name}/rollback` `{version}`（admin）——归档当前版本，把历史快照写回为新版本；内置模板不可回填。前端 Studio 加"🕓 版本"面板（版本列表 + 回填按钮）。
- **P6 定时巡检执行历史**：新增 `GET /api/fusion/team/schedules/{task_id}/runs`（代理 DeerFlow `/api/scheduled-tasks/{id}/runs`，limit/offset 分页）。
- **单测**：`test_team_templates.py` 增至 9 项（新增回填成功 / 未知版本拒绝 / 内置模板拒绝）。

**影响的文档**
- [04-融合桥契约](04-fusion-contract.md) v1.4.0
- [06-团队模板](06-team-templates.md) v1.4.0
- [08-路线图](08-roadmap.md) v1.5.0

---

## 2026-09-10 · v1.4.0 · 路线图 P4/P5：上游能力接入 + 模板生态

**变更摘要**
- **P4-2 定时团队巡检**：`fusion.py` 新增 `POST /api/fusion/team/schedule`（用团队+工作流创建 DeerFlow 定时任务，`assistant_id` 绑团队主代理、`prompt` 取工作流 task）、`GET /team/schedules`、`POST /team/schedules/{id}/{pause|resume|trigger}`、`DELETE /team/schedules/{id}`；对接 DeerFlow `POST /api/scheduled-tasks`（cron/interval + timezone）。前端 Studio 加"⏰ 定时巡检"面板。
- **P4-3 Machines 定位更正**：调研确认 PenguinHarness Machines 是"把服务端装到另一台机器"的 SSH 远程部署通道（非评测计算农场），原路线图描述有误，已更正为不做代码接入。
- **P4-1 官方 Docker 镜像**：README 部署段补充拉取官方镜像说明。
- **P4-4 编程式子代理契约化**：进程内 API（`create_deerflow_agent` + `SubagentRuntime`）由 deer-flow 侧承载，Gateway 通过 managed-subagent API 管理（P1 已落地）。
- **P5-1 模板版本管理**：导入同名模板版本号 +1 并归档旧版本到 `<name>.history.json`；新增 `GET /team/templates/{name}/versions`；列表/导出含版本号；修复 `.history.json` 被误列为模板的 bug。
- **P5-2 模板来源标记**：导入请求加 `source` 字段随资产保留。
- **单测**：新增 `test_team_templates.py`（5 项：v1 创建 / 版本递增归档 / history 不列为模板 / 内置名拒绝 / 合并读取）。

**影响的文档**
- [04-融合桥契约](04-fusion-contract.md) v1.3.0
- [06-团队模板](06-team-templates.md) v1.3.0
- [08-路线图](08-roadmap.md) v1.4.0

**ADR**
- [ADR-0011 定时团队巡检 与 上游能力接入边界](./ADR/ADR-0011-scheduler-and-upstream-boundary.md)

---

## 2026-09-10 · v1.3.0 · 路线图 P3：团队模板资产化

**变更摘要**
- **P3-1 模板资产化**：`fusion.py` 新增自定义模板存储（`gateway/config/team_templates/<name>.json`，原子写）+ `_all_templates()`/`_get_template()` 合并读取（自定义同名覆盖内置）；新增 `GET /api/fusion/team/templates/{name}/export`（developer）与 `POST /api/fusion/team/templates/import`（admin，校验 + 内置名冲突 409）；5 处 `TEAM_TEMPLATES.get` 引用统一改为 `_get_template`（含 evolution.py）。
- **P3-2 通用团队模板**：新增 3 个非跨境内置模板——research-ops（研究分析）、support-ops（客户支持）、dev-ops（软件开发），各含 soul + members + workflows。
- **前端**：Studio 团队编排区加"📥 导入模板 / 📤 导出"按钮（文件选择 + 下载 JSON），列表标记 custom 模板。

**影响的文档**
- [04-融合桥契约](04-fusion-contract.md) v1.2.0
- [06-团队模板](06-team-templates.md) v1.2.0
- [08-路线图](08-roadmap.md) v1.3.0

**ADR**
- [ADR-0010 团队模板资产化](./ADR/ADR-0010-template-assets.md)

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
