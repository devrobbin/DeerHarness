# 04 · 融合桥契约（Fusion Bridge Contract）

| 项 | 值 |
|---|---|
| **版本** | v1.5.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0003、ADR-0004、ADR-0008、ADR-0010、ADR-0011、ADR-0012 |
| **变更摘要** | 专家评审修订：PAT scope 改为引用 07（SSOT）；私有实现符号改行为语义；定义读取端点修正；白名单表述如实；编程式子代理状态统一为"契约化" |

## 设计哲学

> 融合桥是"真融合"而非门户聚合：**PenguinHarness 负责 Agent 定义，DeerFlow 2.X 负责执行运行时**。DeerHarness 是中间的编排 + 进化控制面。

## 核心契约

### 1. 定义读取（PenguinHarness）

- Agent 定义经 penguin 项目级 API 读取：`GET /api/projects/{project_id}/agents/{agent_id}/config`（session cookie 认证）。
- 定义含 `system_prompt`（systemConfigYaml 解析）与 `tools`。
- **工具映射**：penguin 工具名经 Gateway 内部映射表转为 DeerFlow 工具白名单（如 `code_exec→bash`、`web_search→web_search`）；Agent 无工具声明时使用默认白名单：**读 + 写工作区 + 搜索（不含 bash 执行）**——防止 tools:null 继承父代理全部工具的能力放大。

### 2. 运行时同步（→ DeerFlow 2.X，双轨）

**首选：managed-subagent HTTP API**（`GET/POST/PUT /api/subagents`）：

- 每成员先查存在 → `PUT` 更新或 `POST` 创建；请求字段（name/display_name/description/system_prompt/tools/model=inherit/enabled）与 config 轨语义等价。
- 优点：无需改 config.yaml、无需重启 deer-flow 网关。
- **回退：config.yaml 写入**（原子写 + hash 比对 + 变更才重启网关，去重窗口 120s）。
- 统一入口按返回路径返回 "api" / "config"。**适用范围（诚实边界）**：团队 sync 与进化目标解析已接统一入口；**团队 run 主路径尚未接入**（仍走 config 轨），已知缺口见 docs/07 与 ADR-0012。
- 主代理（orchestrator）人设动态注入真实成员清单；penguin 同步的 prompt 附来源声明包装与长度截断。

### 3. 运行调用（DeerFlow 2.X）

**认证（2.X 基准）**：`DEERFLOW_PAT`（Personal Access Token）→ `Authorization: Bearer`。最小 scope 与增量授权规则**以 [07-安全与护栏](07-safety.md) 为唯一主场**（SSOT），本文不再重复列清单。

**Run 生命周期（2.X：/runs/wait 优先 + 轮询回退）**：

```
POST /api/threads                        创建线程（幂等）
POST /api/threads/{id}/runs/wait         创建 run 并阻塞到终态（2.X 首选）
   └─ 同 Create Run body + Idempotency-Key
   └─ 完成 → 返回 final state（含 messages，直接提取 AI 回复）
   └─ 不可用/异常 → 回退 POST /runs + GET /runs/{run_id} 轮询
GET  /api/threads/{id}/state             提取 AI 回复（回退路径）
```

**已知缺口（评审披露）**：wait 请求受 httpx 客户端 60s 总超时约束，**超 60s 的长任务会抛 ReadTimeout 且当前不触发轮询回退**（进化长评测受影响）——修复方案见 ADR-0012。

**2.X 特性落地**：
- `Idempotency-Key`：超时/审批后复测重试不重复执行同一逻辑请求（chat 非流式 / fusion 评测 / 进化团队评测覆盖；fusion/chat 直连路径未接，见 docs/07）。
- `subagent_stop_reason=token_capped`：2.X 子代理 token 硬顶信号 → 成本护栏识别。
- `total_input_tokens` / `total_output_tokens`：run 级用量计价。

### 4. 团队编排

- 团队 run：`POST /api/fusion/team/run` 启动；`GET /api/fusion/team/status/{thread_id}` 非阻塞轮询；`GET /api/fusion/team/graph/{thread_id}` FlowGraph。
- 成员状态实时刷新（与 chat 一致的非阻塞 + 轮询）；team_runs 持久化支持重启恢复。
- 进化产物合并进团队成员人设（运行时"基础模板 + 覆盖"）。
- **定时巡检（P4/P6）**：`POST /api/fusion/team/schedule` 用团队 + 工作流创建 DeerFlow 定时任务（`assistant_id` = 团队主代理，`prompt` = 工作流 task）；配套列表/控制/删除/执行历史。**前置条件：需先执行过团队 sync（当前 schedule 仅同步主代理，不同步成员子代理）**。安全考量（成本盲区/prompt 注入/频率上限）见 docs/07。
- **模板资产（P3/P5）**：导出/导入/版本历史/回填/市场索引 API 清单**以 [06-团队模板](06-team-templates.md) 为唯一主场**（SSOT）。

### 5. 编程式子代理（契约化状态）

进程内 API（`create_deerflow_agent` + `SubagentRuntime`）需在 deer-flow 进程内构造——DeerHarness 作为外部控制面无法直接调用，**由 deer-flow 侧承载**；Gateway 通过 managed-subagent HTTP API 间接管理（已落地）。与 08-roadmap 的"✅ 契约化"口径一致。

## 版本链：契约演进约束

> **融合桥契约变更 = 文档 major 版本升级 + ADR。** 任何接口路径、认证方式、字段语义的破坏性变化，必须先更新本文档与 `docs/CHANGELOG.md`，再动代码。

### 已定契约版本

| 契约面 | 版本 | 状态 |
|---|---|---|
| 认证（PAT 优先） | 2.X 基准 | ✅ 已实现（2026-09-10） |
| Idempotency-Key | 2.X 基准 | ✅ 已实现（2026-09-10） |
| /runs/wait（wait 优先 + 轮询回退） | 2.X 基准 | ✅ 已实现（2026-09-10）；⚠️ 60s 超时不回退缺口见上 |
| managed-subagent API（双轨） | 2.X | ✅ 已实现（2026-09-10）；⚠️ 团队 run 主路径未接入 |
| 编程式子代理（进程内） | 2.X | 📄 契约化——由 deer-flow 侧承载（ADR-0011） |

## 相关文档

- 架构：[03-系统架构](03-architecture.md)
- 进化（SSOT 主场）：[05-进化引擎](05-evolution.md)
- 模板/巡检 API（SSOT 主场）：[06-团队模板](06-team-templates.md)
- 已知缺口：[07-安全与护栏](07-safety.md)
- 决策：[ADR-0003](./ADR/ADR-0003-deerflow-2x-baseline.md)、[ADR-0004](./ADR/ADR-0004-pat-idempotency.md)、[ADR-0008](./ADR/ADR-0008-wait-subagent-api.md)、[ADR-0012](./ADR/ADR-0012-expert-review.md)
