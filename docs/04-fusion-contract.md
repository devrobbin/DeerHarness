# 04 · 融合桥契约（Fusion Bridge Contract）

| 项 | 值 |
|---|---|
| **版本** | v1.4.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0003、ADR-0004、ADR-0008、ADR-0010、ADR-0011 |
| **变更摘要** | P5 收尾：模板版本回填；P6：定时巡检执行历史 |

## 设计哲学

> 融合桥是"真融合"而非门户聚合：**PenguinHarness 负责 Agent 定义，DeerFlow 2.X 负责执行运行时**。DeerHarness 是中间的编排 + 进化控制面。

## 核心契约

### 1. 定义读取（PenguinHarness）

- Agent 定义经 `/api/projects/:projectId/agents` 拉取（session cookie 认证）。
- 定义含 `system_prompt`（systemConfigYaml → system_prompt）与 `tools`。
- 工具经白名单映射到 DeerFlow 工具（`_PENGUIN_TOOL_MAP`，如 `code_exec→bash`）；无声明时用只读 + 搜索保守白名单（防能力放大）。

### 2. 运行时同步（→ DeerFlow 2.X）

- 同步写入 `subagents.custom_agents`（config.yaml）：成员 agent → 子代理（description / system_prompt / tools 白名单 / skills:null）。
- 写入带 **hash 比对 + 原子写 + 写锁**，仅在变更时重启 deer-flow 网关（去重窗口 120s）。
- 主代理（orchestrator）经 `_sync_orchestrator` 生成，含 `{team_members}` 占位符注入成员清单。

### 3. 运行调用（DeerFlow 2.X）

**认证（2.X 基准）**：`DEERFLOW_PAT`（Personal Access Token）→ `Authorization: Bearer`，最小权限 scope（`threads:read` / `runs:create` / `runs:read` / `runs:cancel`）。未配置 PAT 时回退 email/password OAuth2 表单登录 + CSRF 双提交（老部署兼容，非设计基准）。

**Run 生命周期（2.X：/runs/wait 优先 + 轮询回退）**：

```
POST /api/threads                        创建线程（幂等）
POST /api/threads/{id}/runs/wait         创建 run 并阻塞到终态（2.X 首选）
   └─ 同 Create Run body + Idempotency-Key
   └─ 完成 → 返回 final state（含 messages，直接提取 AI 回复）
   └─ 不可用/异常 → 回退 POST /runs + GET /runs/{run_id} 轮询
GET  /api/threads/{id}/state             提取 AI 回复（回退路径）
```

**2.X 特性落地**：
- `Idempotency-Key`：超时/审批后复测重试不重复执行同一逻辑请求（chat / fusion 评测 / 进化团队评测全覆盖）。
- `/runs/wait`：非流式场景优先阻塞等待，减少轮询请求；失败回退轮询保持兼容。
- `subagent_stop_reason=token_capped`：2.X subagent token_budget 硬顶信号 → 成本护栏识别。
- `total_input_tokens` / `total_output_tokens`：真实 token 计价（`_estimate_run_cost`），替代估算。

### 3b. 子代理同步（双轨）

**DeerFlow 2.X 首选：managed-subagent HTTP API**（`GET/POST/PUT/DELETE /api/subagents`）：

- 每成员 `GET /api/subagents/{name}` 查存在 → `PUT` 更新或 `POST /api/subagents` 创建。
- 请求体字段与 config 写入一一对应（name/display_name/description/system_prompt/tools/model=inherit/enabled）。
- 优点：无需改 config.yaml、无需重启 deer-flow 网关。
- API 不可用（404/405/403，老部署）→ 回退 `_write_subagents_config`（config.yaml 原子写 + 重启）。

统一入口 `sync_subagents(team)` → 返回 (成员列表, 路径: "api" / "config")。团队 sync 与进化目标解析均走此双轨。

### 4. 团队编排

- 团队 run：`POST /api/fusion/team/run` 启动；`GET /api/fusion/team/status/{thread_id}` 非阻塞轮询；`GET /api/fusion/team/graph/{thread_id}` FlowGraph。
- 成员状态实时刷新（与 chat 一致的非阻塞 + 轮询）；team_runs 持久化支持重启恢复。
- 进化产物经 `_apply_member_overrides` 合并进团队成员人设。
- **模板资产（P3/P5）**：`GET /api/fusion/team/templates/{name}/export` 导出 JSON 资产；`POST /api/fusion/team/templates/import` 导入自定义模板（版本号 + 历史归档）；`GET /api/fusion/team/templates/{name}/versions` 版本历史；`POST /api/fusion/team/templates/{name}/rollback` 回填历史版本；模板读取统一走 `_get_template`（内置 + 自定义合并，自定义同名覆盖）。
- **定时巡检（P4/P6）**：`POST /api/fusion/team/schedule` 用团队 + 工作流创建 DeerFlow 定时任务（`assistant_id` = 团队主代理，`prompt` = 工作流 task）；`GET /team/schedules`、`POST /team/schedules/{id}/{pause|resume|trigger}`、`DELETE /team/schedules/{id}`、`GET /team/schedules/{id}/runs`（执行历史）。代理 DeerFlow `POST /api/scheduled-tasks`（需 PAT 加 `threads:write`）。

## 版本链：契约演进约束

> **融合桥契约变更 = 文档 major 版本升级 + ADR。** 任何接口路径、认证方式、字段语义的破坏性变化，必须先更新本文档与 `docs/CHANGELOG.md`，再动代码。

### 已定契约版本

| 契约面 | 版本 | 状态 |
|---|---|---|
| 认证（PAT 优先） | 2.X 基准 | ✅ 已实现（2026-09-10） |
| Idempotency-Key | 2.X 基准 | ✅ 已实现（2026-09-10） |
| /runs/wait（wait 优先 + 轮询回退） | 2.X 基准 | ✅ 已实现（2026-09-10，P1） |
| managed-subagent API（双轨） | 2.X | ✅ 已实现（2026-09-10，P1） |
| 编程式子代理（create_deerflow_agent / SubagentRuntime，进程内） | 2.X | 🔜 规划（见 08-路线图 P4） |

## 相关文档

- 架构：[03-系统架构](03-architecture.md)
- 进化：[05-进化引擎](05-evolution.md)
- 决策：[ADR-0003](./ADR/ADR-0003-deerflow-2x-baseline.md)、[ADR-0004](./ADR/ADR-0004-pat-idempotency.md)、[ADR-0008](./ADR/ADR-0008-wait-subagent-api.md)
