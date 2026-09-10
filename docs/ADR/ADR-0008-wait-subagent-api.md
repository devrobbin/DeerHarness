# ADR-0008 · /runs/wait 接入与 managed-subagent API 双轨

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [04-融合契约](../04-fusion-contract.md)、[03-架构](../03-architecture.md)、[08-路线图](../08-roadmap.md) |

## 背景

路线图 P1 要求融合桥深度对齐 DeerFlow 2.X：
- `/runs/wait` 端点（创建 run 并阻塞到终态，配合 Idempotency-Key）可减少非流式场景的轮询请求、支持安全重试。
- DeerFlow 2.X 提供 managed-subagent HTTP API（`GET/POST/PUT/DELETE /api/subagents`），可替代"直接改 config.yaml + 重启网关"的子代理注册方式。

## 决策

1. **`/runs/wait` 优先 + 轮询回退**：`deerflow_client.run_and_wait()` 统一封装——先 POST `/runs/wait`（带幂等键）；端点不可用/异常时回退 POST `/runs` + GET `/runs/{run_id}` 轮询。chat / fusion 评测 / 进化团队评测全部接入。
2. **子代理同步双轨**：`fusion.sync_subagents()` 统一入口——优先逐成员 GET→PUT/POST `/api/subagents`（managed subagent，无需改 config / 无需重启）；API 不可用（老部署 404/405/403）时回退 `_write_subagents_config`（config.yaml 原子写 + 重启）。
3. **PAT 最小 scope 明确**：`threads:read` + `runs:create` + `runs:read`；`runs:cancel` / `threads:write` / `threads:delete` 按需追加。

## 后果

- 非流式对话/评测/进化用 2.X 原生 wait 语义，重试安全（幂等键），网络请求更少。
- 新部署子代理注册走 HTTP API，配置热更新无需重启；老部署自动回退不破坏兼容。
- PAT 授权模板文档化，最小权限落地。
