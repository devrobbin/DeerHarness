# ADR-0003 · DeerFlow 2.X 为基准

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [01-愿景](../01-vision.md)、[03-架构](../03-architecture.md)、[04-融合契约](../04-fusion-contract.md) |

## 背景

DeerFlow 已发布 **2.0（ground-up rewrite）**：从 v1 深度研究框架升级为 Super Agent Harness。融合桥原按 v1 契约（OAuth2 表单登录、subagents 配置、轮询）实现，需明确基准版本。

## 决策

**DeerFlow 以 2.X 为既定基准**（用户确认）。融合桥按 2.X 契约实现：
- 认证：`DEERFLOW_PAT`（PAT + scopes）优先，OAuth2 表单登录仅作老部署兼容回退。
- Run 生命周期：支持 `Idempotency-Key`、`/runs/wait` 语义（规划）。
- 子代理：`subagents.custom_agents` 保留；编程式 `create_deerflow_agent` + `SubagentRuntime` 双轨演进（规划）。
- 成本：`token_budget` / `subagent_stop_reason=token_capped` 信号。

## 后果

- 新功能一律按 2.X 契约；老版 OAuth2 不回退为设计基准。
- 融合桥契约变更 = 文档 major + ADR。
