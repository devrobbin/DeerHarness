# ADR-0007 · 安全模型

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [07-安全与护栏](../07-safety.md) |

## 背景

平台代理两个上游、驱动 AI 自我改进、涉及真实成本。需分层安全模型：平台访问 / 上游凭据 / 成本护栏 / 进化安全。

## 决策

- **平台访问**：API Key + RBAC（admin/developer/viewer）；除 health 外全路由鉴权。
- **上游凭据**：penguin session cookie（必填、禁默认口令）；DeerFlow 2.X PAT 优先（见 ADR-0004）。
- **成本护栏**：请求级对话预算（MAX_COST_PER_REQUEST）、进化单任务成本上限（max_cost_per_evolution）、真实 token 计价、2.X token_capped 信号。
- **进化安全策略**：max_rounds / max_cost / require_human_approval / blocked_domains；进化污染防护（验证轮二次校验）；版本一致性（团队级联合进化）。
- **工程加固**：配置原子写、并发锁、会话恢复、SQLite 版本化迁移、DNS rebinding 防护。

## 后果

- 安全是内建而非事后补丁；护栏配置集中在 Settings → Safety。
- 成本从估算演进为真实计价 + 上游预算信号。
