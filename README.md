# DeerHarness

**Fusion of PenguinHarness and DeerFlow — Self-evolving Agent construction meets robust multi-agent orchestration.**

> 🎨 项目图标：`web/public/deerharness-logo.svg`（戴鹿角的企鹅 + Harness 轨道，融合两上游元素的原创设计，未使用任一上游图标）

DeerHarness 是 **PenguinHarness**（自进化 Agent 构建工具）与 **ByteDance DeerFlow**（长链路多智能体执行框架）的融合项目，提供统一管理平台：

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
│  :8001      │   │  ness :7364 │   │  :8080      │   │  :3000      │
│  执行框架    │◄──┤  Agent 工厂  │   │  FastAPI    │◄──┤  Next.js    │
│  沙箱/记忆   │   │  自进化训练   │   │  认证/RBAC  │   │  6 个页面    │
└─────────────┘   └─────────────┘   │  WebSocket  │   └─────────────┘
        │  Trace 上报                  └─────┬───────┘
        └──────────── 数据闭环（进化反馈）─────┘
```

- **Gateway**（FastAPI）：统一 API 网关，代理上游服务；API Key + RBAC 认证；WebSocket 实时推送；Trace 采集与成本统计存储。
- **WebUI**（Next.js 14 + Tailwind）：Dashboard / Chat / Agent Studio / Evolution Lab / Monitor / Settings 六个页面。
- **Docker Compose**：一键编排 DeerFlow + PenguinHarness + Gateway + Web 四服务。

## 📁 目录结构

```
DeerHarness/
├── gateway/                    # FastAPI 网关 (:8080)
│   ├── main.py                 # 入口 v0.7.0（7 组路由 + WebSocket）
│   ├── auth.py                 # API Key + RBAC (admin/developer/viewer)
│   ├── ws.py                   # WebSocket 连接管理 + 实时推送
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/                 # settings.json / users.json / traces.json
│   └── routes/
│       ├── agents.py           # Agent 管理（代理 PenguinHarness）
│       ├── evolution.py        # 进化任务（代理 PenguinHarness）
│       ├── traces.py           # Trace 数据流（采集/查询）
│       ├── dashboard.py        # 聚合统计 + 三服务健康检查
│       ├── cost.py             # 成本统计（按 Agent/时间聚合）
│       ├── settings.py         # 模型/技能/MCP/渠道/安全策略
│       └── users.py            # 用户管理
├── web/                        # Next.js WebUI (:3000)
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
| Agents | `GET/POST /api/agents` | 列出 / 创建 Agent（真实代理 penguin，跨项目展开） |
| Agents | `DELETE /api/agents/{id}?project_id=` | 删除 Agent |
| Evolution | `GET /api/evolution/tasks` | 跨 Agent 展开 Benchmark 清单（真实端点） |
| Evolution | `POST /api/evolution/start` | 501：真实 penguin 仅支持 CLI 启动评测 |
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
