# ADR-0012 · 专家评审与文档-实现对齐决策

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-11） |
| **影响文档** | 全部 docs/（01~08、README、09-guides） |
| **来源** | 5 人专家评审团（产品战略 / 系统架构 / 安全合规×2 / 文档工程 / 开发者体验），逐条核对代码事实 |

## 背景

产品文档体系（v1.6.0）建立后，组织 5 位专家并行评审，共产出 P0×5 / P1×约20 / P2×约30 项发现。多位专家独立命中同一批问题（如端口 3000/3002 矛盾被 3 家命中），交叉验证置信度高。

## 关键决策

### 1. 产品叙事与实现对齐（诚实优先）

- **"团队级协同进化" → "以团队真实运行为评测单元的协同进化"**：核对 `evolution.py::_propose_improvement`，每轮 LLM 只生成单个改进方案（soul / member_prompt / workflow_task 三选一），评测是团队级、改进是单点。措辞降级为代码可证的真话；"多目标联合改进（bundle proposal）"列入远期方向。
- **"业务目标分" → "质量目标分"**：评分是单次 LLM-judge 主观打分（无 rubric、无业务数据接入），定位句与流程描述同步修正，并在 01-vision 披露评分体系的诚实边界。
- 模板"市场"更名/加注为"**模板库（一键副本）**"——当前仅内置目录，无第三方分发。

### 2. 安全已知缺口如实披露（先文档后代码）

以下代码级缺口在 docs/07「已知缺口」节如实标注，修复建议单列待排期：

- **viewer 角色形同虚设**（P0）：代码仅有 admin/developer 守卫，无 viewer 只读拦截，viewer 实际拥有 developer 全部写权限。
- **`/metrics` 无鉴权**（P1）、**machines 端点降权**（P1）：违反"除 health 外全部鉴权"的自我承诺。
- **三个成本护栏与实现不符**（P1）：`MAX_COST_PER_REQUEST` 仅覆盖流式 chat；`max_evolution_rounds` 设置项因请求参数永非零而永不生效（应改 `min(task, safety)` 语义）；`evolution_token_budget` 数值从不下发 DeerFlow（仅本地开关）。
- **`scripts/import_crossborder_agents.py` 硬编码种子密码 `penguin-3983` 入库**（P0）：需轮换密码 + 脚本改环境变量读取（评审建议重写 git 历史视部署情况评估）。
- **配置回退轨在 PAT-only 与容器两种形态不可用**（P1）：探活用 email/password（PAT 模式必 503 误报）；容器内无 docker CLI 且 config 挂载只读——承诺收窄为"容器部署仅支持 API 轨"。
- **双轨同步未覆盖 `_prepare_team` 主路径**（P0）：团队 run 仍走 config 写入 + docker restart；**`/runs/wait` 60s 超时不回退轮询**（P0）：进化长评测会系统性失败。

### 3. 文档体系结构性改进

- **SSOT 规则**：每个事实类内容指定唯一主场（PAT scope → 07；护栏配置 → 05；进化闭环 → 05；模板/巡检 API → 06；API 运行时真相源 = Gateway OpenAPI `/docs`），其余位置一句话 + 链接。
- **新增任务层 `docs/09-guides.md`**：5 分钟上手 + PAT/模板/巡检 3 个 how-to + troubleshooting（此前完全缺失）。
- **根 README 减负**：收缩为定位 + 架构 + 快速开始 + docs 导航；联调/PAT 教程迁入 09-guides。
- **词汇表**挂入 docs/README（soul / orchestrator / 验证轮 / P 编号等核心词）。
- **ADR supersede 约定**：被后续决策取代/实现时，原 ADR 追加"后续：见 ADR-00XX"。

## 后果

- 文档承诺与代码实现首次系统对齐；"虚假安全感"条款（护栏、RBAC）全部显式披露或修正。
- 8 项代码级缺口进入待办（viewer 拦截、/metrics 鉴权、machines 挂 admin、min() 语义、token_budget 透传、凭据参数化、wait 超时回退、_prepare_team 接入双轨），按安全优先级排期。
- 文档从"设计事实记录"升级为"含竞争格局、成功指标、验证轨道的完整产品叙事"。
