# 07 · 安全与护栏（Security & Guardrails）

| 项 | 值 |
|---|---|
| **版本** | v1.1.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0004、ADR-0007 |
| **变更摘要** | P1 落地：PAT 最小授权 scope 明确为 threads:read / runs:create / runs:read（可按需加 runs:cancel / threads:write） |

## 分层安全模型

### 1. 平台访问（DeerHarness 自身）

- **API Key + RBAC**：admin / developer / viewer 三级。
  - admin：用户管理、审批进化、融合同步（写）。
  - developer：对话、评测、团队运行、启动进化。
  - viewer：只读。
- 除 `/api/health` 外全部路由挂鉴权（P0-1 修复）。
- 管理员初始 API Key 启动播种（`bootstrap_admin`）。

### 2. 上游凭据

- **PenguinHarness**：session cookie 登录（userId/password），必填环境变量，禁止默认口令（P0-3）。
- **DeerFlow 2.X**：**PAT（Personal Access Token）优先**——Gateway 单点持有，最小权限 scope（`threads:read` + `runs:create` + `runs:read`；需取消 run 才加 `runs:cancel`，需归档/删除线程才加 `threads:write`/`threads:delete`）；避免共享管理员账号。email/password OAuth2 仅为老部署兼容回退。
- `trust_env=False` 直连，避免本机系统代理拦截回环（Windows Clash :7890 → 502）。

### 3. 成本护栏

| 护栏 | 配置 | 默认 |
|---|---|---|
| 请求级对话预算（近 1h 累计） | `MAX_COST_PER_REQUEST` | $2.0（0=不限） |
| 进化单任务成本上限 | `max_cost_per_evolution` | $5.0 |
| 真实 token 计价 | `MODEL_INPUT_PRICE_PER_M` / `MODEL_OUTPUT_PRICE_PER_M` | $0.27 / $1.10 |
| DeerFlow 2.X token_budget 硬顶 | `subagent_stop_reason=token_capped` 信号 | 接入中 |

### 4. 进化安全策略（Settings → Safety）

| 策略 | 作用 |
|---|---|
| `max_evolution_rounds` | 限轮数，防无限循环 |
| `max_cost_per_evolution` | 累计评估成本超限停止 |
| `require_human_approval` | 进化结果人工审批门 |
| `blocked_domains` | 过滤改进建议（禁入领域） |

**进化污染防护**：进化版输出需二次校验（验证轮复测），不因追求指标牺牲生产稳定性。
**版本一致性**：以团队为单位联合进化，避免单子代理进化破坏协作协议。

## 工程加固（评审落地）

| 项 | 措施 |
|---|---|
| DNS rebinding | WebSocket 头鉴权；CORS 白名单 |
| 配置原子写 | 临时文件 + os.replace |
| 并发安全 | 配置写锁；任务级互斥锁；重启去重窗口 |
| 会话恢复 | 进程重启续跑 running 任务；team_runs 持久化 |
| SQLite 版本化迁移 | user_version 顺序迁移链 |
| 可观测性 | RequestLogMiddleware + Prometheus /metrics |

## 相关文档

- 架构：[03-系统架构](03-architecture.md)
- 进化护栏：[05-进化引擎](05-evolution.md)
- 决策：[ADR-0007](./ADR/ADR-0007-security-model.md)
