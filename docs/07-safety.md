# 07 · 安全与护栏（Security & Guardrails）

| 项 | 值 |
|---|---|
| **版本** | v1.5.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0004、ADR-0007、ADR-0011、ADR-0012 |
| **变更摘要** | G1-G8 修复落地；G9/G10/G5 余项修复（巡检护栏/模板供应链/预算覆盖）；缺口全部闭环（G4 留运维轮换动作） |

## 分层安全模型

### 1. 平台访问（DeerHarness 自身）

**RBAC 三级角色**（admin / developer / viewer）与守卫实现：

| 角色 | 守卫 | 实际能力 |
|---|---|---|
| admin | `require_admin` | 全部：用户管理、进化审批/回滚、模板导入/回填、定时巡检删除、全部 Settings 写、`/metrics` |
| developer | `require_developer`（接受 admin+developer） | 对话、评测、团队运行、启动进化、模板导出/版本查看、定时巡检创建 |
| viewer | `get_current_user` 只读拦截（**G1 已修复**） | 仅 GET/HEAD/OPTIONS；写操作一律 403 |

- 除 `/api/health` 外全部路由挂登录鉴权（router 级 `get_current_user`）；`/metrics` 的鉴权状态见已知缺口。
- 管理员初始 API Key 启动播种（`bootstrap_admin`）。**注意**：`ADMIN_API_KEY` 未配置时 dev 模式会启动成功但全部 401 且无法自助创建用户（死锁），compose 部署用 `:?` 强制可避免——dev 模式务必配置。
- **鉴权调用约定**：所有 API 请求带 `Authorization: Bearer <ADMIN_API_KEY 或用户 API Key>`（`.env` 的 `ADMIN_API_KEY` 即首个 admin key）。

### 2. 上游凭据

- **PenguinHarness**：session cookie 登录（userId/password），必填环境变量，禁止默认口令（P0-3）。
- **DeerFlow 2.X**：**PAT（Personal Access Token）优先**——Gateway 单点持有，避免共享管理员账号。email/password OAuth2 仅为老部署兼容回退。
- **PAT 最小 scope（SSOT 主场，其他文档引用此处）**：
  - 基础三项：`threads:read` + `runs:create` + `runs:read`（全库无 cancel 调用，`runs:cancel` 按需追加）。
  - **定时巡检需增量 `threads:write`**（DeerFlow 创建定时任务要求 `threads:write` + `runs:create`）。
  - 归档/删除线程才加 `threads:delete`。PAT 只能收窄其所有者权限，无法扩权。
- `trust_env=False` 直连，避免本机系统代理拦截回环（Windows Clash :7890 → 502）。

### 3. 成本护栏

> 护栏配置与实现语义的 **SSOT 主场在 [05-进化引擎](05-evolution.md)**，此处仅列平台级项。

| 护栏 | 配置 | 默认 | 覆盖范围（如实披露） |
|---|---|---|---|
| 请求级对话预算（近 1h 累计） | `MAX_COST_PER_REQUEST` | $2.0（0=不限） | ⚠️ **仅流式 chat**（`/api/chat/stream`）；非流式 chat、fusion/chat、团队 run 均**绕过** |
| 进化子代理 token 预算 | `evolution_token_budget` | None | ⚠️ 本地开关（触顶即停），数值不下发 DeerFlow |
| 真实 token 计价 | `MODEL_INPUT_PRICE_PER_M` / `MODEL_OUTPUT_PRICE_PER_M` | $0.27 / $1.10 | run 级用量统计 + 估算兜底 |

### 4. 进化安全策略

配置与实现语义见 [05-进化引擎「护栏」](05-evolution.md)（SSOT）。要点：`blocked_domains` 是启发式过滤（大小写敏感子串、仅生成阶段、可同义绕过）——**最终防线是人工审批门**。

## 已知缺口（评审 ADR-0012，全部闭环）

> 专家评审发现的文档承诺与代码实现之间的缝隙。**G1-G10 已于 2026-09-11 全部修复**（v1.7.1 + v1.7.2）；G4 遗留一项运维动作。

| # | 缺口 | 风险 | 状态 |
|---|---|---|---|
| G1 | viewer 角色无只读拦截（权限提升） | 多角色部署不可接受 | ✅ **已修复**：`get_current_user` 层统一 viewer+非GET→403（单测覆盖） |
| G2 | `/metrics` 无鉴权 | 内网信息枚举 | ✅ **已修复**：挂 `require_admin` |
| G3 | machines 端点降权 | 内网拓扑泄露 | ✅ **已修复**：挂 `require_admin` |
| G4 | `import_crossborder_agents.py` 硬编码种子密码入库 | 已发生的凭据泄露 | ✅ **已完全闭环（2026-09-11）**：脚本改环境变量读取；penguin 管理员密码已轮换（scrypt 哈希直更 web.db + 吊销全部 141 个历史会话 + `.env` 同步更新，三项验证通过）。泄露的旧密码 `penguin-3983` 已失效。注意：仓库若将来公开，仍建议评估重写 git 历史（`git filter-repo`） |
| G5 | 成本护栏绕过路径（请求级预算仅流式 chat） | 成本失控 | ✅ **已修复**：预算计量扩展到非流式 chat / fusion chat / 团队 run / start（按轨迹前缀 dh-chat/dh-fusion/dh-eval/dh-team 计量）；`max_rounds` 改 `min()` 语义 |
| G6 | 回退轨限制（PAT-only 探活 503 / 容器形态不可用） | 误导性错误 | ✅ **已修复探活**（PAT 模式 Bearer 探活）；容器形态仅支持 API 轨的收窄承诺保留（docs/04） |
| G7 | 团队 run 主路径未接双轨 | 容器形态团队 run 失败 | ✅ **已修复**：`_prepare_team` 改调 `sync_subagents` 统一入口 |
| G8 | `/runs/wait` 60s 超时不回退 | 进化长评测失败 | ✅ **已修复**：wait 路径独立长超时（poll_timeout+30s）+ `TimeoutException` 纳入回退捕获 |
| G9 | 定时巡检护栏盲区（成本/频率/注入） | 成本/注入 | ✅ **已修复**：创建时护栏——全局数量上限 20 / 频率下限（interval≥1h，cron≥1h）/ blocked_domains 过滤 / prompt 长度上限 8000 |
| G10 | 模板导入供应链（soul 无截断/包装） | 提示注入 | ✅ **已修复**：导入 soul 截断至 8000 字符 + 来源声明包装（与 penguin 同步路径同等防护）；共享仍建议先审阅 |

## 信息泄露面

- `/api/settings/system` 与 `/api/dashboard/health` 会返回宿主路径/内网 URL 字段——内网部署可接受，公网暴露前需收敛（/system 建议挂 admin）。
- WS 认证支持 `Sec-WebSocket-Protocol` 头（优先）与 `?token=` 查询参数回退；**query 回退会进访问日志**，建议始终用头方式。
- SearXNG（:8088）无鉴权——仅绑本机/内网。
- 全栈默认无 TLS：公网部署务必置于反向代理（nginx/caddy）之后。

## 定时巡检（P4 新端点的安全考量）

定时任务把 prompt + cron 持久化到 DeerFlow 由**上游周期触发**，带来三个网关护栏之外的暴露：

1. **成本盲区**：周期执行完全绕开 `MAX_COST_PER_REQUEST` 与 `max_cost_per_evolution`。
2. **持久化 prompt**：prompt 写入即长期生效，无创建时审查。
3. **频率滥用**：developer 可注册大量高频 cron。

缓解（待实现）：创建时成本预估、频率/数量上限、blocked_domains 过滤。当前缓解：定时任务列表/删除可见可停（admin），创建走 developer 权限。

## 模板资产供应链（P3 新端点的安全考量）

- 模板导入（admin）是**提示注入信任边界**：soul 原样成为主代理 system prompt。当前无长度上限、无来源包装（对比 penguin 同步路径有 8000 字符截断 + 来源声明）。
- 当前指引：**只导入可信来源**；共享先导出审阅再导入。
- 待实现：导入路径复用包装+截断；导入时显式提示"不可信输入"。

## 工程加固（已有实现）

| 项 | 措施 |
|---|---|
| 注入消毒 | 所有拼进上游 URL 的用户参数经 `valid_id` 白名单校验 |
| SSRF 防护 | 模型/MCP 测试 URL 经私网 IP 校验；OpenAPI fetch 同样防护 |
| 凭据 fail-fast | 必填 env 缺失即拒启；compose `:?` 强制；运行时数据全部 gitignore（经 git 历史核查未泄漏） |
| 配置原子写 | 临时文件 + os.replace；写锁 |
| 并发安全 | 任务级互斥锁（单进程内有效）；重启去重窗口 |
| 会话恢复 | 进程重启续跑 running 任务；team_runs 持久化 |
| SQLite 版本化迁移 | user_version 顺序迁移链 |
| 凭据掩码 | bot_token 类配置只写不回显 |
| 代理收敛 | 上游客户端 `trust_env=False`（防系统代理 SSRF 面） |

## 相关文档

- 架构与限制：[03-系统架构](03-architecture.md)
- 护栏 SSOT：[05-进化引擎](05-evolution.md)
- 决策：[ADR-0007](./ADR/ADR-0007-security-model.md)、[ADR-0012](./ADR/ADR-0012-expert-review.md)
