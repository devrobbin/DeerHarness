# 03 · 系统架构

| 项 | 值 |
|---|---|
| **版本** | v1.2.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0002、ADR-0003、ADR-0004、ADR-0008、ADR-0011、ADR-0012 |
| **变更摘要** | 专家评审修订：部署口径修正（两服务编排）；存储路径修正；新增「限制与风险」「扩展性路径」；补 openapi_factory 组件；Machines 状态更新 |

## 组件拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│              DeerHarness WebUI（Next.js 14 :3002）                │
│    Dashboard · Chat · Studio · Evolution Lab · Monitor · Settings│
└────────────────────────────────┬─────────────────────────────────┘
                                 │ REST + WebSocket（:8080）
┌────────────────────────────────▼─────────────────────────────────┐
│                DeerHarness Gateway（FastAPI 0.7.x :8080）          │
│  ┌──────────┬──────────┬───────────┬───────────┬───────────────┐  │
│  │  Auth    │  WS 推送  │ Trace/成本 │ 安全护栏   │  配置管理      │  │
│  │ RBAC     │ (ws.py)  │(trace_store)│(settings)│ (evolution_store)│
│  └──────────┴──────────┴───────────┴───────────┴───────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │            Fusion Bridge（融合桥）                           │  │
│  │  读 penguin 定义 → 同步子代理 → 编排运行 → 进化闭环           │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │  支撑组件：auth · ws · observability（/metrics）             │  │
│  │            trace_store · evolution_store · openapi_factory   │  │
│  │           （OpenAPI→工具工厂，含 SSRF 防护）                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────────┬──────────────┘
                   │                                  │
                   ▼                                  ▼
┌─────────────────────────────┐   ┌──────────────────────────────────┐
│      PenguinHarness         │   │   DeerFlow 2.X（Super Harness）   │
│      Agent 生产 + 自进化     │   │   threads/runs（wait+Idempotency）│
│      Machines（远程部署通道， │   │   subagents · sandbox · memory    │
│      状态已只读展示）         │   │   PAT 认证 · token_budget         │
└─────────────────────────────┘   └──────────────────────────────────┘
```

## 数据流

### 数据闭环（Trace → 进化 → 成本）

```
DeerFlow 2.X run 执行
   └─→ record_trace（traces.db：run 级用量统计 + 估算兜底）
         ├─→ Dashboard 成本/趋势
         └─→ 进化评测打分依据
进化应用改进
   └─→ config_overrides（evolution.db）
         └─→ fusion 合并"基础模板 + 覆盖" → 团队编排立即使用
```

### 持久化（存储位置以代码为准，评审 P1-2 修正）

| 存储 | 位置 | 内容 |
|---|---|---|
| **根 `config/`**（运行时 DB） | `config/traces.db`、`config/evolution.db` | Trace 轨迹+成本；进化任务/版本快照/审批队列/配置覆盖/**override_history 覆盖历史**/团队 run 成员 |
| **`gateway/config/`**（平台配置） | `settings.json`、`users.json`、`agent_prefs.json`、`team_templates/` | 平台配置（含安全策略）；用户+API Key；Agent 偏好；自定义团队模板资产 |

> 记忆口诀：**根 config = 数据库，gateway/config = 配置与资产**。

## 关键架构决策

1. **Gateway 为唯一控制面**：所有上游代理经 Gateway，RBAC/审计/护栏统一在此（例外与已知缺口见 docs/07）。
2. **DeerFlow 2.X 为运行基准**：PAT 认证优先、Idempotency-Key、`/runs/wait` 优先 + 轮询回退、managed-subagent API 双轨。
3. **配置"基础 + 覆盖"合并**：进化产物通过 config_overrides 叠加，不破坏基础模板，可回滚。
4. **原子写与去重**：配置文件临时文件 + os.replace；子代理配置 hash 比对，变更才重启。
5. **可观测性**：RequestLogMiddleware + Prometheus `/metrics`（鉴权状态见 docs/07）；WS 实时推送进化/团队事件。
6. **子代理同步双轨**：2.X managed-subagent HTTP API 优先（不改 config / 不重启）；API 不可用时回退 config.yaml 写入 + 重启。**已知缺口：团队 run 主路径尚未接入统一入口**（见 docs/07 / ADR-0012）。

## 限制与风险（评审新增，如实披露）

| 限制 | 影响 | 缓解 |
|---|---|---|
| **单进程内存态**：`_TEAM_RUNS`、`_task_locks`、`_last_config_hash` 均为进程内状态 | 多 worker 部署时互斥锁/hash 去重失效（团队任务双轮执行防护**仅单进程内有效**） | 生产默认单 worker；多 worker 需先引入分布式锁（见扩展性路径） |
| **SQLite 单写者** | 高并发写会竞争（timeout=15s） | 单机规模够用；扩展路径见下 |
| **config 回退轨会重启 DeerFlow** | 重启窗口内进行中的团队 run 被杀（120s 去重窗口仅缓解） | 优先走 API 轨（P1 双轨）；容器形态回退轨不可用（见 docs/07） |
| **成本检查时序**：进化成本护栏在**轮首**检查，单轮内超支不中断 | 单轮成本可能超预算 | token_capped 即停补足（docs/05） |

## 扩展性路径

| 当前（单机假设） | 扩展方向 | 已有正向留口 |
|---|---|---|
| SQLite（trace/evolution） | → Postgres | 存储层已隔离（trace_store / evolution_store 独立模块） |
| 内存注册表（`_TEAM_RUNS`） | → Redis | 读写集中在 `_register_team_run` / `_load_team_run` 两个函数 |
| 进程内 asyncio.Lock | → 分布式锁 | 任务锁经 `_task_lock()` 单点封装 |
| users.json RBAC | → 租户维度 | auth 模块独立，角色模型已有三层 |
| PAT 单点持有 | → 每租户凭据 | Gateway 单点代理的架构不变，仅凭据存储扩展 |

## 部署拓扑

- **Docker Compose**：编排 **DeerHarness 自有两服务**（Gateway + Web）；上游（DeerFlow 2.X、PenguinHarness）用各自官方方式启动（评审修正：不是"四服务编排"）。
- **开发模式**：`start.sh` 或分别 `uvicorn` / `next dev`（宿主机 dev 模式支持 config 回退轨；容器形态仅支持 API 轨，见 docs/07）。
- **上游**：DeerFlow 2.X nginx 前门 :2026；PenguinHarness :7368（官方 Docker 镜像或开发模式）。

## 相关文档

- 融合契约：[04-融合桥契约](04-fusion-contract.md)
- 已知缺口：[07-安全与护栏](07-safety.md)
- 决策记录：[ADR](./ADR/)
- 部署：[09-guides](09-guides.md) 与根 README「快速开始」
