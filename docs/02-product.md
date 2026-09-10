# 02 · 产品设计

| 项 | 值 |
|---|---|
| **版本** | v1.0.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0001、ADR-0003 |
| **变更摘要** | 初始成稿：6 页面产品结构 + 核心用户流程 |

## 产品形态

统一 Web 控制台（Next.js 14 + Tailwind，端口 3002），6 个页面即 6 项产品能力。所有页面经 Gateway（FastAPI :8080）代理上游，带 RBAC 与 WebSocket 实时推送。

## 功能地图

| 页面 | 产品能力 | 主要接口 | 关联模块 |
|---|---|---|---|
| **Dashboard** | 聚合视图：Agent 数 / 三服务健康 / 成本 / 进化趋势 | `/api/dashboard/*` | observability, cost |
| **Chat** | 经网关直连 DeerFlow 2.X 真实对话（DeepSeek V4 Flash） | `/api/chat` + SSE `/stream` | deerflow_client |
| **Studio** | Agent 编辑 + **团队编排** + FlowGraph 可视化 | `/api/agents`、`/api/fusion/team/*` | fusion bridge |
| **Evolution Lab** | 三层进化闭环 + 审批队列 + 得分曲线 | `/api/evolution/*` | evolution engine |
| **Monitor** | 服务健康 / 进化监控 / 团队编排监控 / 实时事件流 | `/api/dashboard/health` + WS | ws.py |
| **Settings** | 模型 / 技能 / MCP / 渠道 / 安全策略 / 用户 | `/api/settings/*`、`/api/users` | settings, users |

## 核心用户流程

### 流程 A：组建团队并真实运行（Studio）

```
1. 选择团队模板（Amazon 专项 / TikTok Shop / 内容工厂 / 履约财税 / 跨境总监）
2. Gateway 读取 penguin Agent 定义（system prompt / tools）
3. 写入 DeerFlow 2.X 子代理配置（subagents.custom_agents）+ 工具白名单映射
4. 同步 orchestrator（主代理）→ 团队可运行
5. 发起 team run：主代理用 task 工具分派子任务（可并行）→ 汇总
6. FlowGraph 实时可视化成员调用关系；成员状态实时刷新（非阻塞 + 轮询）
```

### 流程 B：驱动团队进化（Evolution Lab）

```
1. 选择进化目标：agent / workflow / team + 轮次 + 目标分
2. 每轮：用团队/通用评测用例真实运行 → LLM 评分
3. 未达标 → LLM 生成结构化改进方案（受 blocked_domains 过滤）
4. 审批门：require_human_approval=true → 入审批队列；false → 自动应用
5. 审批通过 → 应用改进（写 config_overrides）→ 标记验证轮 → 复测
6. 达标/轮次/成本上限 → 结束；版本得分曲线可对比、可回滚
```

### 流程 C：对话与监控（Chat + Monitor）

- Chat：创建线程 → run（flash 模式）→ 轮询/SSE 流式 → 提取 AI 回复；请求级预算护栏。
- Monitor：三服务健康检查 + 进化任务进度 + 团队 run 状态 + WS 实时事件流。

## 关键产品决策（沿革）

| 决策 | 当时背景 | 结论 |
|---|---|---|
| 6 页面拆分 | 功能横向覆盖全生命周期 | Dashboard / Chat / Studio / Evolution / Monitor / Settings |
| 团队编排非阻塞 + 轮询 | 长任务阻塞体验差 | 成员状态实时轮询刷新，与 chat 一致（commit 5c5cecde） |
| 进化任务后台逐轮推进 | 评测耗时长 | 后台 asyncio 逐轮；审批模式每轮挂起等人工 |
| web 端口固定 3002 | 避免本地其他项目冲突 | 端口 3002（commit 36f609ad） |

## 多语言（i18n）

- 界面文案随语言切换；运行时缺键回退英文。
- 覆盖 monitor / dashboard / chat / settings 等页面。

## 相关文档

- 架构：[03-系统架构](03-architecture.md)
- 进化：[05-进化引擎](05-evolution.md)
- 团队模板：[06-团队模板](06-team-templates.md)
