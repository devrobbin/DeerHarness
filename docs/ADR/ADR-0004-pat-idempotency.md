# ADR-0004 · PAT 认证与 Idempotency

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [04-融合契约](../04-fusion-contract.md)、[07-安全](../07-safety.md) |

## 背景

DeerFlow 2.X 将认证从 v1 的 email/password OAuth2 升级为 **PAT（Personal Access Token）+ 权限作用域**（`threads:read` / `runs:create` / `runs:read` / `runs:cancel`），并为 run 引入 `Idempotency-Key`（重试同一逻辑请求不重复执行）。

## 决策

1. **认证 PAT 优先**：`DEERFLOW_PAT` 存在则用 `Authorization: Bearer`；未配置时回退 email/password OAuth2 + CSRF 双提交（老部署兼容）。Gateway 单点持有 PAT，避免共享管理员账号。
2. **Idempotency-Key 全覆盖**：chat / fusion 评测 / evolution 团队评测的 run 创建均附唯一幂等键（`dh-chat-{thread}-{nonce}`、`dh-eval-{thread}`、`dh-evolve-{thread}`），超时或审批后复测重试不重复执行。

## 后果

- 新部署用 PAT，最小权限 scope；README 补充 PAT 申请说明。
- 老部署（仅 email/password）仍可用，但不作为设计基准。
- 幂等键为进化"复测轮"与 chat 超时重试提供安全重试。
