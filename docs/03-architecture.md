# 03 · 系统架构

| 项 | 值 |
|---|---|
| **版本** | v1.1.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0002、ADR-0003、ADR-0004、ADR-0008 |
| **变更摘要** | P1 落地：/runs/wait 接入；子代理同步双轨（managed-subagent API 优先 / config 回退） |

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
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────────┬──────────────┘
                   │                                  │
                   ▼                                  ▼
┌─────────────────────────────┐   ┌──────────────────────────────────┐
│   PenguinHarness (2.0)      │   │   DeerFlow 2.X（Super Harness）    │
│   Agent 生产 + 自进化        │   │   threads/runs（wait+Idempotency） │
│   Machines（远期）           │   │   subagents · sandbox · memory    │
│   Model catalog 1000+       │   │   PAT 认证 · token_budget         │
└─────────────────────────────┘   └──────────────────────────────────┘
```

## 数据流

### 数据闭环（Trace → 进化 → 成本）

```
DeerFlow 2.X run 执行
   └─→ record_trace（traces.db：真实 token 用量计价）
         ├─→ Dashboard 成本/趋势
         └─→ 进化评测打分依据
进化应用改进
   └─→ config_overrides（evolution.db）
         └─→ fusion 合并"基础模板 + 覆盖" → 团队编排立即使用
```

### 持久化

| 存储 | 内容 |
|---|---|
| `config/traces.db`（SQLite） | Trace 轨迹 + 真实成本 |
| `config/evolution.db`（SQLite） | 进化任务 / 版本快照 / 审批队列 / 配置覆盖 / 团队 run 成员 |
| `gateway/config/settings.json` | 平台配置（模型/技能/MCP/渠道/安全策略） |
| `gateway/config/users.json` | 用户 + API Key |
| `gateway/config/agent_prefs.json` | Agent 偏好 |

## 关键架构决策

1. **Gateway 为唯一控制面**：所有上游代理经 Gateway，RBAC/审计/护栏统一在此。
2. **DeerFlow 2.X 为运行基准**：PAT 认证优先、Idempotency-Key、`/runs/wait` 优先 + 轮询回退、managed-subagent API 双轨。
3. **配置"基础 + 覆盖"合并**：进化产物通过 config_overrides 叠加，不破坏基础模板，可回滚。
4. **原子写与去重**：配置文件临时文件 + os.replace；子代理配置 hash 比对，变更才重启容器。
5. **可观测性**：RequestLogMiddleware + Prometheus /metrics；WS 实时推送进化/团队事件。
6. **子代理同步双轨**：2.X managed-subagent HTTP API 优先（不改 config / 不重启）；API 不可用时回退 config.yaml 写入 + 重启。

## 部署拓扑

- **Docker Compose**：DeerFlow + PenguinHarness + Gateway + Web 四服务一键编排（`docker-compose.yml`）。
- **开发模式**：`start.sh` 或分别 `uvicorn` / `next dev`。
- **上游**：DeerFlow 2.X nginx 前门 :2026；PenguinHarness :7368。

## 相关文档

- 融合契约：[04-融合桥契约](04-fusion-contract.md)
- 决策记录：[ADR](./ADR/)
- 部署：根目录 README「快速开始」
