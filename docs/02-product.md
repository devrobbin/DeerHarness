# 02 · 产品设计

| 项 | 值 |
|---|---|
| **版本** | v1.1.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0001、ADR-0012 |
| **变更摘要** | 专家评审修订：流程 B 压缩为鸟瞰（SSOT 主场在 05）；新增「前置条件与首次运行」；决策表去 commit 引用、补产品级决策 |

## 产品形态

统一 Web 控制台（Next.js 14 + Tailwind，端口 **3002**），6 个页面即 6 项产品能力。所有页面经 Gateway（FastAPI :8080）代理上游，带 RBAC 与 WebSocket 实时推送。

> Gateway 自带交互式 API 文档（Swagger UI）：`http://localhost:8080/docs`——所有端点可直接调试，是 API 用法的运行时真相源。

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
1. 选择团队模板（5 跨境 + 3 通用，或导入自定义模板）
2. Gateway 读取 penguin Agent 定义（system prompt / tools）
3. 同步为 DeerFlow 2.X 子代理（双轨：managed-subagent API 优先 / config 回退）
4. 同步 orchestrator（主代理）→ 团队可运行
5. 发起 team run：主代理用 task 工具分派子任务（可并行）→ 汇总
6. FlowGraph 实时可视化成员调用关系；成员状态实时刷新
```

### 流程 B：驱动团队进化（Evolution Lab）

```
评估（真实运行 + LLM 评分）→ 改进建议 → 审批门 → 应用 → 验证轮复测
```

> 闭环机制、护栏、状态机的**完整定义以 [05-进化引擎](05-evolution.md) 为准**（SSOT），此处仅作鸟瞰。

### 流程 C：对话与监控（Chat + Monitor）

- Chat：创建线程 → run（flash 模式）→ 轮询/SSE 流式 → 提取 AI 回复；请求级预算护栏。
- Monitor：三服务健康检查 + 进化任务进度 + 团队 run 状态 + WS 实时事件流 + Machines 只读状态。

## 前置条件与首次运行

> 产品承诺"开箱即用"，但有四项前置条件（评审 P1-3 修订）；缺一项的降级行为如下：

| 前置条件 | 缺失时的行为 | 处理 |
|---|---|---|
| **penguin 侧预置 Agent**（模板成员按 agent_id 过滤） | 通用模板可能只剩主代理（"空壳团队"）；跨境模板缺成员 | 运行 `python scripts/import_crossborder_agents.py` 播种 15 个跨境 Agent（⚠️ 该脚本需先改为环境变量读凭据，见 docs/07 已知缺口）；通用模板成员需自建同名 Agent |
| **`DEEPSEEK_API_KEY`**（LLM 评分 + 改进建议） | 评测所有用例记 0 分、改进生成返回 None → 进化任务以 0 分"成功"结束（**严重误导**） | 配置 key 后再使用进化功能（改进建议：start 时无 key 应直接拒绝，待实现） |
| **DeerFlow 2.X PAT** | 融合桥无法调用运行时 | 见 docs/09-guides「配置 PAT」 |
| **安全策略配置**（Settings → Safety） | 使用默认护栏（轮次 10 / 成本 $5 / 审批开） | 按需调整；护栏已知缺口见 docs/07 |

## 关键产品决策

| 决策 | 背景 | 结论 |
|---|---|---|
| 6 页面拆分 | 功能横向覆盖全生命周期 | Dashboard / Chat / Studio / Evolution / Monitor / Settings |
| 团队编排非阻塞 + 轮询 | 长任务阻塞体验差 | 成员状态实时轮询刷新，与 chat 一致 |
| 进化任务后台逐轮推进 | 评测耗时长 | 后台 asyncio 逐轮；审批模式每轮挂起等人工 |
| 审批门默认开启 | AI 自我改进不可控风险 | `require_human_approval=true` 为出厂默认；自动模式是显式选择 |
| 内置 3 个通用模板 | 验证团队模型不绑定跨境领域 | 引擎通用性证明 + 生态示例，不作为独立 GTM 方向（见 01-vision 目标用户） |

> 沿革细节（何时变更、commit 记录）由 [CHANGELOG](CHANGELOG.md) 与 [ADR](./ADR/) 承载。

## 多语言（i18n）

界面支持中英文切换（Settings → Appearance），运行时缺键回退英文；覆盖全部 6 个页面导航与常用文案。

## 相关文档

- 架构：[03-系统架构](03-architecture.md)
- 进化（SSOT 主场）：[05-进化引擎](05-evolution.md)
- 团队模板：[06-团队模板](06-team-templates.md)
- 上手指南：[09-guides](09-guides.md)
