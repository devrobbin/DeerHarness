# DeerHarness

**Fusion of PenguinHarness and DeerFlow — Self-evolving Agent construction meets robust multi-agent orchestration.**

> 🎨 项目图标：`web/public/deerharness-logo.svg`（戴鹿角的企鹅 + Harness 轨道，融合两上游元素的原创设计，未使用任一上游图标）

> 📚 **产品设计与版本链**：完整设计文档见 [docs/](docs/README.md)（愿景 / 产品 / 架构 / 融合契约 / 进化 / 团队模板 / 安全 / 路线图 + CHANGELOG + ADR）。**DeerFlow 以 2.X 为基准。**

DeerHarness 是 **PenguinHarness**（自进化 Agent 构建工具）与 **ByteDance DeerFlow 2.X**（长链路多智能体执行框架）的融合项目，提供统一管理平台：

- 🐧 **PenguinHarness**：Agent 工厂 + 训练场 —— 解决"Agent 从哪里来、如何变强"
- 🦌 **DeerFlow**：Agent 操作系统 + 工作台 —— 解决"Agent 如何协作、如何稳定干活"
- 🛠️ **DeerHarness Gateway + WebUI**：统一控制台，管理 Agent、进化任务、Trace、成本与安全策略

| | PenguinHarness | DeerFlow |
|---|---|---|
| 定位 | "Agent 工厂 + 训练场" | "Agent 操作系统 + 工作台" |
| 解决痛点 | Agent 开发成本高、迭代慢、难以自动优化 | 长任务中 Agent 易失忆、上下文混乱 |
| 核心理念 | 让 Agent 自己造 Agent，还能自己变强 | 让 Agent 自己跑几个小时，也能跑对 |
| 上游仓库 | [Prism-Shadow/penguin-harness](https://github.com/Prism-Shadow/penguin-harness) | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) |
| 许可证 | Apache-2.0 | MIT |

## 🏛️ 系统架构

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  DeerFlow   │   │ PenguinHar- │   │  Gateway    │   │  WebUI      │
│  2.X :2026  │   │  ness :7368 │   │  :8080      │   │  :3002      │
│  执行框架    │◄──┤  Agent 工厂  │   │  FastAPI    │◄──┤  Next.js    │
│  沙箱/记忆   │   │  自进化训练   │   │  认证/RBAC  │   │  6 个页面    │
└─────────────┘   └─────────────┘   │  WebSocket  │   └─────────────┘
        │  Trace 上报                  └─────┬───────┘
        └──────────── 数据闭环（进化反馈）─────┘
```

- **Gateway**（FastAPI）：统一 API 网关，代理上游服务；API Key + RBAC 认证；WebSocket 实时推送；Trace 采集与成本统计存储。
- **WebUI**（Next.js 14 + Tailwind）：Dashboard / Chat / Agent Studio / Evolution Lab / Monitor / Settings 六个页面。
- **Fusion Bridge（真融合）**：PenguinHarness 负责 **Agent 定义**（system prompt 等），DeerFlow 2.X 提供 **执行运行时**（沙箱/记忆/子代理/搜索）。`/api/fusion/sync` 把 penguin Agent 同步为 DeerFlow Custom Agent（soul），`/api/fusion/chat` 以该身份在 DeerFlow 中运行 — Agent Studio 可一键切换运行环境。
- **Docker Compose**：一键编排 DeerFlow + PenguinHarness + Gateway + Web 四服务。

## 📁 目录结构

```
DeerHarness/
├── docs/                       # 📚 产品设计文档体系 + 版本链（见下方文档链接）
│   ├── README.md               # 文档门户 + 版本链总览
│   ├── 01-vision.md ~ 08-roadmap.md  # 愿景/产品/架构/融合契约/进化/团队模板/安全/路线图
│   ├── CHANGELOG.md            # 版本链主日志（变更强制双写）
│   └── ADR/                    # 架构决策记录 ADR-0001 起
├── gateway/                    # FastAPI 网关 (:8080)
│   ├── main.py                 # 入口 v0.7.0（9 组路由 + WebSocket）
│   ├── auth.py                 # API Key + RBAC (admin/developer/viewer)
│   ├── deerflow_client.py      # DeerFlow 2.X 客户端（PAT 优先 / OAuth2 回退）
│   ├── penguin_client.py       # PenguinHarness 客户端（session cookie）
│   ├── ws.py                   # WebSocket 连接管理 + 实时推送
│   ├── evolution_store.py      # 进化任务/版本/审批/配置覆盖（SQLite）
│   ├── openapi_factory.py      # OpenAPI 工具工厂
│   ├── observability.py        # 请求日志 + Prometheus 指标
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/                 # settings.json / users.json / traces.json / evolution.db
│   └── routes/
│       ├── agents.py           # Agent 管理（代理 PenguinHarness）
│       ├── evolution.py        # 进化实验室（三层闭环 + 审批队列）
│       ├── fusion.py           # 融合桥（同步/团队编排/评测）
│       ├── chat.py             # Chat（DeerFlow 2.X 对话 + SSE）
│       ├── traces.py           # Trace 数据流（采集/查询）
│       ├── dashboard.py        # 聚合统计 + 三服务健康检查
│       ├── cost.py             # 成本统计（按 Agent/时间聚合）
│       ├── settings.py         # 模型/技能/MCP/渠道/安全策略
│       └── users.py            # 用户管理
├── web/                        # Next.js WebUI (:3002)
│   ├── src/app/                # dashboard / chat / studio / evolution / monitor / settings
│   ├── src/components/         # agent-studio / evolution-lab / settings
│   ├── src/lib/                # api.ts / useWebSocket.ts
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml          # 四服务一键编排
├── Makefile                    # up / down / logs / dev ...
├── .env.example                # 环境变量模板
├── start.sh                    # 开发模式启动（不用 Docker）
└── README.md
```

## 🚀 快速开始

### Docker 一键部署（DeerHarness 自有服务）

```bash
# 1. 配置环境变量
cp .env.example .env   # 可选：PENGUIN_PASSWORD 指向真实 penguin 密码

# 2. 启动 Gateway + WebUI
make up                # 等价于 docker compose up -d --build

# 3. 访问
#    WebUI:     http://localhost:3000
#    Gateway:   http://localhost:8080/api/health
```

> **上游服务**（DeerFlow / PenguinHarness）通过各自的官方方式启动，见下方"真实上游联调"：
> - DeerFlow 官方栈：`cd ../deer-flow && docker compose -f docker/docker-compose.yaml up -d`（nginx 前门 :2026）
> - PenguinHarness 开发模式：`cd ../penguin-harness && pnpm install && pnpm dev:server`（:7368）
> - PenguinHarness **官方 Docker 镜像**：上游由 release workflow 发布官方镜像，可直接拉取部署（免本地 pnpm 构建）；具体镜像名与 tag 见上游仓库 Release / 文档。需要多机部署时，可用上游 **Machines** 页面把 PenguinHarness 装到另一台主机（基于 `~/.ssh/config`，仅管理员）。

### 开发模式（不用 Docker）

```bash
# 仅启动 Gateway（需已安装 Python 依赖）
cd gateway && pip install -r requirements.txt && uvicorn main:app --port 8080 --reload

# 仅启动 Web（需已安装 Node 20+）
cd web && npm install && npm run dev

# 或一键同时启动两者
bash start.sh
```

## 🔌 主要 API

| 分组 | 端点 | 说明 |
|---|---|---|
| **Chat** | `POST /api/chat` | **DeerHarness WebUI → DeerFlow 2.X 真实对话**（DeepSeek V4 Flash，flash 模式） |
| Agents | `GET/POST /api/agents` | 列出 / 创建 Agent（真实代理 penguin，跨项目展开） |
| Agents | `DELETE /api/agents/{id}?project_id=` | 删除 Agent |
| Evolution | `GET /api/evolution/tasks` | 跨 Agent 展开 Benchmark 清单（真实端点） |
| Evolution | `POST /api/evolution/start` | **三层进化闭环**：agent / workflow / team 进化（后台逐轮 + 审批队列） |
| Evolution | `POST /api/evolution/tasks/{id}/approve\|reject\|stop` | 审批/拒绝/停止进化任务 |
| Fusion | `POST /api/fusion/team/run` 等 | 团队编排运行 / 状态 / FlowGraph（融合桥） |
| Traces | `POST /api/traces` | DeerFlow 执行轨迹上报 |
| Traces | `GET /api/traces?agent_id=` | 轨迹查询 |
| Dashboard | `GET /api/dashboard/summary` | 聚合统计（Agent 数为真实数据） |
| Dashboard | `GET /api/dashboard/health` | 三服务健康检查（penguin 真实探测） |
| Cost | `GET /api/cost/summary` | 成本统计 |
| Settings | `GET/POST /api/settings/{models,skills,mcp,channels}` | 平台配置 CRUD |
| Safety | `GET/PUT /api/settings/safety` | 进化安全策略 |
| Users | `POST /api/users` | 创建用户（需 admin，Bearer API Key） |
| WS | `WS /ws/evolution/{task_id}` | 进化进度实时推送 |

## 🐧 真实上游联调（PenguinHarness）

Gateway 已适配 **真实 penguin-harness API**（与初始框架假设不同，实际端点已核实）：

- Agent 位于 `/api/projects/:projectId/agents`（非顶层 `/api/agents`）
- 认证：session cookie（`POST /api/auth/login`，body 为 `userId/password`）
- 评测：`/api/projects/:pid/agents/:aid/benchmarks`（仅查询；启动走 CLI）

```bash
# 开发模式启动 penguin-harness（同级目录 ../penguin-harness）
cd ../penguin-harness && pnpm install && pnpm dev:server
# 首次启动会打印种子管理员密码，如：Seeded built-in admin "admin" — password: penguin-xxxx

# Gateway 侧环境变量（默认值已适配开发模式）
export PENGUIN_API=http://localhost:7368
export PENGUIN_USER_ID=admin
export PENGUIN_PASSWORD=<首次启动打印的密码>
```

## 💬 DeerFlow 对话集成（2.X 基准）

DeerHarness 的 Chat 页面（`:3002/chat`）经 Gateway 代理 DeerFlow 官方栈：

- **认证（2.X 首选）**：`DEERFLOW_PAT`（Personal Access Token）→ `Authorization: Bearer`。
- **回退**（老部署）：`DEERFLOW_EMAIL` + `DEERFLOW_PASSWORD` 走 `POST /api/v1/auth/login/local`（OAuth2 表单）→ 会话 + CSRF 双提交 cookie。
- 对话：创建线程 → `POST /threads/{id}/runs`（flash 模式 + `Idempotency-Key`）→ `/runs/wait` 或轮询 → 提取 AI 回复。
- 环境变量：`DEERFLOW_API`（默认 `http://localhost:2026`）、`DEERFLOW_PAT`、`DEERFLOW_EMAIL`、`DEERFLOW_PASSWORD`。

### 申请 PAT（最小授权模板）

用交互式登录会话创建（PAT 不能自管理 PAT，防止令牌泄露后自动造凭据）：

```bash
# 1. 在 DeerFlow WebUI 登录（交互会话）
# 2. 创建 PAT（scopes 为最小权限子集；原始 token 仅返回一次，立即保存）
curl -X POST http://localhost:2026/api/v1/auth/pats \
  -H "Content-Type: application/json" \
  -H "Cookie: <登录会话 cookie>" \
  -d '{
        "name": "deerharness-gateway",
        "scopes": ["threads:read", "runs:create", "runs:read"],
        "expires_in_days": 90
      }'
# 响应 { "token": "dfp_..." } → 填入 DEERFLOW_PAT
```

> **最小 scope**：`threads:read`（读线程/状态）+ `runs:create`（创建 run）+ `runs:read`（查 run）。
> **定时巡检（Scheduled Tasks）需额外加 `threads:write`**（DeerFlow 创建定时任务要求 `threads:write` + `runs:create`）。
> 仅当需要归档/删除线程时才加 `threads:delete`；需取消 run 才加 `runs:cancel`。PAT 只能收窄其所有者权限，无法扩权。

### 子代理同步（双轨）

DeerFlow 2.X 提供 managed-subagent HTTP API（`GET/POST/PUT/DELETE /api/subagents`）。`/api/fusion/team/sync` 优先走 API 注册/更新成员子代理（无需改 config、无需重启）；API 不可用（老部署）时自动回退 `config.yaml` 写入 + 重启网关。

> **联网搜索**：已启用 **SearXNG**（自托管聚合搜索，`:8088`，无 API key），
> 配置了国内可用的搜索源（baidu / bing / sogou / mojeek / yandex）。
> DeerFlow 的 `web_search` 工具指向 `http://host.docker.internal:8088`，
> 深度研究（多轮搜索 + 引用）真实可用。如需替换为 Serper/Tavily 等商业 API，
> 修改 `../deer-flow-run/config.yaml` 中 web_search 工具条目即可。

## 🗺️ 开发进度（Phase）

| Phase | 内容 | 状态 |
|---|---|---|
| 1 | 页面骨架 + Gateway 路由 + Agent Studio + Evolution Lab | ✅ |
| 2 | Trace 数据流（采集 → 存储 → 查看） | ✅ |
| 3 | 统一 Dashboard（聚合统计 + 健康检查） | ✅ |
| 4 | 成本统计 + Monitor 页面 | ✅ |
| 5 | Settings（模型/技能/MCP/渠道/安全策略） | ✅ |
| 6 | WebSocket 实时推送（进化进度） | ✅ |
| 7 | 多用户 & 权限（API Key + RBAC） | ✅ |
| 8 | Docker Compose 一键部署 | ✅ |

## 🔄 同步上游更新

```bash
# 查看已关联的仓库
git remote -v

# 同步 PenguinHarness 的更新
git fetch upstream-penguin
git merge upstream-penguin/main --allow-unrelated-histories

# 同步 DeerFlow 的更新
git fetch upstream-deerflow
git merge upstream-deerflow/main --allow-unrelated-histories
```

## 🛡️ 安全与避坑

- **进化安全护栏**：Settings 中可配置最大进化轮次、单次进化费用上限、进化结果人工审批、禁止进化领域。
- **进化污染防护**：进化版 Agent 输出需二次校验，不因追求进化指标牺牲生产稳定性。
- **版本一致性**：以"Agent 团队"为单位联合进化，避免单个子代理进化导致协作协议破裂。
- **成本控制**：进化触发与业务价值挂钩（执行次数、成功率阈值）。

## 📄 许可证

本项目为两个上游开源项目的融合：**PenguinHarness**（[Apache-2.0](https://github.com/Prism-Shadow/penguin-harness)）与 **DeerFlow**（[MIT](https://github.com/bytedance/deer-flow)），两者均为宽松许可证，可兼容使用。本项目融合代码的许可证待正式确定后补充（详见 [LICENSE](LICENSE)）。
