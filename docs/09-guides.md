# 09 · 上手指南（Guides & Troubleshooting）

| 项 | 值 |
|---|---|
| **版本** | v1.0.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0012 |
| **变更摘要** | 新增任务层文档：5 分钟上手、3 个 how-to（PAT/模板/巡检）、troubleshooting——评审 DX 缺口补齐 |

## 快速上手（5 分钟跑通第一次团队编排）

> 前置条件与各步骤的降级行为见 [02-产品设计「前置条件」](02-product.md)。

```bash
# 0. 前置：三个仓库同级目录布局（本项目的硬性假设）
#    D:/workspace/
#      ├── deerHarness/       ← 本项目
#      ├── deer-flow/         ← DeerFlow 2.X 源码（config 回退轨需要）
#      ├── deer-flow-run/     ← DeerFlow 运行配置（config.yaml，回退轨写入目标）
#      └── penguin-harness/   ← PenguinHarness 源码

# 1. 配置环境变量（全部必填，缺失启动失败）
cd deerHarness
cp .env.example .env
#    填：PENGUIN_API / PENGUIN_PASSWORD（penguin 首次启动打印的种子密码）
#        DEERFLOW_API / DEERFLOW_PAT（或 DEERFLOW_EMAIL+PASSWORD）
#        ADMIN_API_KEY（自拟强随机串，即首个 admin API Key）
#        DEEPSEEK_API_KEY（进化评分依赖）

# 2. 启动上游
#    DeerFlow 2.X：cd ../deer-flow && docker compose -f docker/docker-compose.yaml up -d  （:2026）
#    PenguinHarness：cd ../penguin-harness && pnpm install && pnpm dev:server            （:7368）

# 3. 启动 DeerHarness 自有两服务
make up                # Gateway :8080 + WebUI :3002（开发模式用 bash start.sh）

# 4. 播种示例 Agent（跨境模板的 15 个成员）
python scripts/import_crossborder_agents.py
#    ⚠️ 该脚本当前硬编码凭据，运行前请先按 docs/07 G4 改为环境变量读取

# 5. 验证
open http://localhost:3002          # WebUI
open http://localhost:8080/docs     # Gateway 交互式 API 文档（Swagger UI，所有端点可调试）
curl -s http://localhost:8080/api/health
```

### 第一次团队编排（Studio 页或 API）

```bash
KEY=<你的 ADMIN_API_KEY>
H="Authorization: Bearer $KEY"

# 1. 看有哪些团队模板
curl -s -H "$H" http://localhost:8080/api/fusion/team/templates

# 2. 发起团队任务（异步启动，立即返回 thread_id）
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"template":"amazon-ops","task":"复盘昨天的广告投放数据并给出调优建议"}' \
  http://localhost:8080/api/fusion/team/start
# → {"thread_id":"dh-team-xxxx"}

# 3. 轮询状态直到 terminal=true（成员状态/最终回复在 members/reply）
curl -s -H "$H" http://localhost:8080/api/fusion/team/status/dh-team-xxxx
```

### 第一次进化（Evolution Lab 页或 API）

```bash
# 1. 启动一次团队进化（3 轮，目标 85 分）
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"target_type":"team","team_id":"amazon-ops","max_rounds":3,"target_score":85}' \
  http://localhost:8080/api/evolution/start
# → {"task_id":"evolve-xxxx"}（后台逐轮推进；默认审批门开启）

# 2. 查看任务与待审批方案
curl -s -H "$H" http://localhost:8080/api/evolution/tasks
curl -s -H "$H" http://localhost:8080/api/evolution/tasks/evolve-xxxx/approvals

# 3. 审批通过（admin key）→ 应用改进并进入验证轮
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"approval_id":1}' \
  http://localhost:8080/api/evolution/tasks/evolve-xxxx/approve

# 4. 看版本得分曲线（回滚：POST .../rollback {"version":1}）
curl -s -H "$H" http://localhost:8080/api/evolution/tasks/evolve-xxxx/versions
```

## How-to 1：配置 DeerFlow 2.X PAT

```bash
# 1. 在 DeerFlow WebUI（:2026）交互式登录
# 2. 用登录会话创建 PAT（原始 token 仅返回一次，立即保存）
curl -X POST http://localhost:2026/api/v1/auth/pats \
  -H "Content-Type: application/json" -H "Cookie: <登录会话 cookie>" \
  -d '{"name":"deerharness-gateway",
       "scopes":["threads:read","runs:create","runs:read"],
       "expires_in_days":90}'
# → {"token":"dfp_..."}

# 3. 填入 .env：DEERFLOW_PAT=dfp_...（配置后 email/password 可省略）
# 4. 需要定时巡检：追加 threads:write（见 docs/07 PAT 最小 scope）
```

> 为什么用 PAT：Gateway 单点持有、最小授权、不共享管理员账号；PAT 不能自管理 PAT（防令牌泄露后自动造凭据）。完整安全模型见 [07-安全与护栏](07-safety.md)。

## How-to 2：导入/导出自定义团队模板

```bash
# 导出（developer）
curl -s -H "$H" http://localhost:8080/api/fusion/team/templates/amazon-ops/export \
  -o team-template-amazon-ops.json

# 修改后导入为新模板（admin；内置名会 409，用新名字）
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  --data-binary @team-template-amazon-ops.json \
  http://localhost:8080/api/fusion/team/templates/import

# 版本管理与回填：重复导入同名 → 版本+1 并归档历史
curl -s -H "$H" http://localhost:8080/api/fusion/team/templates/my-team/versions
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"version":1}' http://localhost:8080/api/fusion/team/templates/my-team/rollback
```

> ⚠️ 导入的模板是**不可信输入**（soul 会成为主代理 system prompt）——只导入可信来源。最小 JSON 示例与校验规则见 [06-团队模板](06-team-templates.md)。

## How-to 3：配置定时团队巡检

```bash
# 前置：该团队已执行过 team sync（schedule 不同步成员子代理，见 docs/06）
# PAT 需含 threads:write

# 创建：工作日每天 9 点巡检（cron + 时区）
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"team_id":"amazon-ops","workflow_id":"daily-inspection",
       "schedule_type":"cron","schedule_spec":{"cron":"0 9 * * *"},
       "timezone":"Asia/Shanghai"}' \
  http://localhost:8080/api/fusion/team/schedule

# 管理：列表 / 暂停 / 恢复 / 立即跑一次 / 删除 / 执行历史
curl -s -H "$H" http://localhost:8080/api/fusion/team/schedules
curl -s -X POST -H "$H" http://localhost:8080/api/fusion/team/schedules/<task_id>/pause
curl -s -X POST -H "$H" http://localhost:8080/api/fusion/team/schedules/<task_id>/trigger
curl -s -H "$H" http://localhost:8080/api/fusion/team/schedules/<task_id>/runs
curl -s -X DELETE -H "$H" http://localhost:8080/api/fusion/team/schedules/<task_id>
```

> ⚠️ 定时任务由 DeerFlow 周期触发、绕开网关成本护栏——当前无频率/成本上限（docs/07「定时巡检」），请自觉控制频率。

## Troubleshooting（常见问题）

| 现象 | 原因 | 修复 |
|---|---|---|
| **WebUI 打不开（访问了 3000）** | WebUI 端口是 **3002**（3000 是容器内部端口） | 访问 `http://localhost:3002` |
| **`make up` 失败：挂载路径不存在** | compose 挂载了兄弟目录 `../deer-flow-run` 与 `../deer-flow`（config 回退轨用） | 按快速上手第 0 步布局 clone 上游仓库；或仅用宿主机 dev 模式 |
| **Gateway 全部 API 返回 401** | 未带鉴权头，或 `ADMIN_API_KEY` 未配置（dev 模式死锁：无 key 无法自助建用户） | 带 `Authorization: Bearer $ADMIN_API_KEY`；dev 模式务必在 .env 配置 ADMIN_API_KEY |
| **penguin 相关 502/登录失败** | penguin 未启动，或 PENGUIN_PASSWORD 不对（首次启动打印的种子密码） | 启动 penguin 并核对密码；日志找 `Seeded built-in admin "admin" — password: penguin-xxxx` |
| **DeerFlow 相关 502** | DeerFlow 官方栈未启动或 :2026 不可达 | `cd ../deer-flow && docker compose -f docker/docker-compose.yaml up -d`，`curl localhost:2026` 验证 |
| **团队 sync 后报 503 "deer-flow 重启后未就绪"** | config 回退轨重启了 deer-flow 网关；**PAT-only 部署下探活必失败（已知缺口 G6）** | PAT 部署同时配置 DEERFLOW_EMAIL/PASSWORD；或确认走 API 轨（2.X managed-subagent 可用时优先） |
| **容器部署团队 sync 失败（Read-only file system / docker not found）** | 容器形态 config 回退轨不可用（无 docker CLI + 只读挂载，已知缺口 G6/G7） | 容器部署仅支持 API 轨；团队 run 主路径接入双轨前，用宿主机 dev 模式 |
| **进化任务 0 分"成功"结束** | 未配置 `DEEPSEEK_API_KEY`（评分与改进都依赖它） | 配置 key；详见 docs/05「评分依赖」 |
| **进化长任务 failed（约 60s 后）** | `/runs/wait` 60s 超时不回退（已知缺口 G8） | 等待修复；短期用 flash 模式/减少用例数 |
| **创建定时巡检 422/403** | PAT 缺 `threads:write`，或团队未先 sync | PAT 加 scope；先 `POST /api/fusion/team/sync` |
| **WS 连不上（4401）** | WS 未带 token | 用 `Sec-WebSocket-Protocol` 头传 token（勿用 query 参数，会进访问日志） |
| **模板导入 409** | name 与内置模板冲突 | 换名（内置不可覆盖） |
| **端口冲突（8080/3002/2026/7368/8088）** | 本机其他服务占用 | 改占用方或对应 env（GATEWAY_PORT / WEB_PORT） |

## 二次开发指引

- **架构入口**：[03-系统架构](03-architecture.md) + `gateway/main.py` 路由挂载表。
- **测试**：后端 `cd gateway && pytest`（60 项）；前端 `cd web && npm test`；全量 lint+build 走 `.github/workflows/ci.yml` 同款（ruff / pytest / tsc / next build）。
- **文档即代码**：任何需求/功能/架构变更**必须双写**——改对应 docs 文档（含版本头）+ `docs/CHANGELOG.md` 追加条目；重要决策新建 ADR（流程见 [docs/README](README.md)）。
- **契约文档原则**：docs/04/06 描述行为语义，不引用私有实现符号；API 用法的运行时真相源是 `/docs`（OpenAPI）。

## 相关文档

- 概念：[01-愿景](01-vision.md) · [02-产品设计](02-product.md)
- 机制：[05-进化引擎](05-evolution.md) · [06-团队模板](06-team-templates.md)
- 安全：[07-安全与护栏](07-safety.md)
