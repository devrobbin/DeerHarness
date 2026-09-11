# DeerHarness 产品文档

> 面向产品与工程的设计文档体系。所有文档带**版本头**，随需求/功能变更同步演进，形成**版本链**（见 [版本链管理](#版本链管理)）。

## 文档地图

| 文档 | 类型 | 说明 | 当前版本 | 上次更新 |
|---|---|---|---|---|
| [01-愿景与定位](01-vision.md) | 概念 | 产品是什么、为谁、解决什么、竞争格局、成功指标 | v1.1.0 | 2026-09-11 |
| [02-产品设计](02-product.md) | 概念 | 产品结构、用户流程、前置条件 | v1.1.0 | 2026-09-11 |
| [03-系统架构](03-architecture.md) | 概念 | 组件、数据流、限制与风险、扩展性路径 | v1.2.0 | 2026-09-11 |
| [04-融合桥契约](04-fusion-contract.md) | 参考 | PenguinHarness × DeerFlow 融合接口契约 | v1.5.0 | 2026-09-11 |
| [05-进化引擎](05-evolution.md) | 参考 | 三层进化闭环、审批、护栏（**护栏配置 SSOT**） | v1.2.0 | 2026-09-11 |
| [06-团队模板](06-team-templates.md) | 参考 | 团队模板资产与编排模型（**模板/巡检 API SSOT**） | v1.5.0 | 2026-09-11 |
| [07-安全与护栏](07-safety.md) | 参考 | RBAC、凭据、已知缺口（**PAT scope SSOT**） | v1.3.0 | 2026-09-11 |
| [08-路线图](08-roadmap.md) | 状态 | 已完成 / 待办 / 验证轨道 / 远期 | v1.7.0 | 2026-09-11 |
| [09-上手指南](09-guides.md) | 任务 | 5 分钟上手、how-to、troubleshooting、二次开发 | v1.0.0 | 2026-09-11 |
| [CHANGELOG](CHANGELOG.md) | 状态 | **版本链主日志**（需求/功能变更入口） | — | 2026-09-11 |
| [ADR](./ADR/) | 状态 | 架构决策记录（索引见下） | — | 2026-09-11 |

### 角色化阅读路径

| 你是谁 | 阅读顺序 |
|---|---|
| **新开发者（想快速用起来）** | 09-guides「快速上手」→ 02-product（30 秒产品形态）→ 遇到问题查 09「Troubleshooting」 |
| **想理解产品的人** | 01-vision → 02-product → 06-team-templates |
| **想改代码的人** | 09「二次开发指引」→ 03-architecture → 04-fusion-contract → ADR |
| **运维/安全** | 07-safety（重点「已知缺口」）→ 03「限制与风险」 |

## 词汇表（Glossary）

| 术语 | 一句话定义 | 详见 |
|---|---|---|
| **soul** | 主代理（orchestrator）的 system prompt 人设，团队模板三要素之一 | 06 |
| **orchestrator / 主代理** | 接收任务、拆解、用 task 工具分派成员并汇总的顶层 Agent | 06 |
| **融合桥（Fusion Bridge）** | 把 penguin 的 Agent 定义同步为 DeerFlow 运行时子代理的缝合层 | 04 |
| **双轨同步** | 子代理注册的两条路径：2.X managed-subagent API 优先，config.yaml 写入回退 | 04 |
| **团队模板** | soul + members + workflows 三要素的可运行团队配置，可导入导出 | 06 |
| **三层进化目标** | agent / workflow / team 三种进化对象 | 05 |
| **进化闭环** | 评估 → 改进建议 → 审批门 → 应用 → 验证轮复测 | 05 |
| **审批门** | `require_human_approval=true` 时改进方案需人工 approve/reject | 05 |
| **验证轮** | 应用改进后的下一轮复测，保证改进被评测（当前不阻断流程） | 05 |
| **负面样本记忆** | 被拒方案的 reason 摘要，阻止下一轮原样再提 | 05 |
| **config_overrides** | 进化产物的存储表：基础模板 + 覆盖的合并机制 | 05 |
| **override_history** | 覆盖写入前的旧值留痕表，支撑回滚 | 05 |
| **token_capped** | DeerFlow 2.X 子代理触发 token_budget 硬顶的停止信号 | 04/05 |
| **PAT** | DeerFlow 2.X Personal Access Token，Gateway 持有的上游凭据 | 07 |
| **P 编号 / Phase** | P1-P6 = 特性批次代号；Phase 1-8 = 平台建设阶段（两套并行） | 08 |
| **已知缺口（G1-G10）** | 文档承诺与代码实现间的真实缝隙清单，如实披露 | 07 |

## SSOT 规则（Single Source of Truth）

> 同一事实多处手写必然漂移（评审发现 3 处已发生的矛盾）。约定：

- **PAT 最小 scope** → 主场 [07-安全与护栏](07-safety.md)，其他文档只链接。
- **护栏配置与实现语义** → 主场 [05-进化引擎](05-evolution.md)。
- **进化闭环机制** → 主场 [05](05-evolution.md)（02 只留鸟瞰）。
- **模板/定时巡检 API 清单** → 主场 [06-团队模板](06-team-templates.md)（04 只留跨上游契约）。
- **API 用法** → 运行时真相源是 Gateway 自动生成的 OpenAPI（`http://localhost:8080/docs`）；手写清单仅作导览。

## 文档索引规范

- **文档命名**：两位序号 + 短横线名，如 `01-vision.md`。新增文档按顺序编号。
- **版本头**：每篇文档顶部 `版本 | 更新时间 | 关联 ADR | 变更摘要` 表格，随内容变更递增 `patch`（小改）/ `minor`（功能级）/ `major`（架构级）。
- **变更必须双写**：任何需求/功能/架构变更，**必须同时**（1）更新对应文档正文与版本头；（2）在 `docs/CHANGELOG.md` 追加一条记录。这是强制规范，禁止"只改代码不改文档"。
- **契约文档原则**：契约文档（04/06）描述**行为语义**，不引用私有实现符号（下划线函数名无稳定性承诺）；符号级细节放代码 docstring。
- **ADR supersede 约定**：某决策被后续 ADR 取代或落地实现时，在原 ADR 末尾追加一行“后续：见 ADR-00XX（日期）”。

### ADR 索引

| ADR | 标题 | 状态 |
|---|---|---|
| [ADR-0001](./ADR/ADR-0001-product-positioning.md) | 产品定位 | 已采纳 |
| [ADR-0002](./ADR/ADR-0002-doc-versioning.md) | 文档版本链与变更规范 | 已采纳 |
| [ADR-0003](./ADR/ADR-0003-deerflow-2x-baseline.md) | DeerFlow 2.X 为基准 | 已采纳（后续：/runs/wait 已由 ADR-0008 落地） |
| [ADR-0004](./ADR/ADR-0004-pat-idempotency.md) | PAT 认证与 Idempotency | 已采纳 |
| [ADR-0005](./ADR/ADR-0005-evolution-loop.md) | 进化闭环设计 | 已采纳 |
| [ADR-0006](./ADR/ADR-0006-team-templates.md) | 团队模板资产 | 已采纳 |
| [ADR-0007](./ADR/ADR-0007-security-model.md) | 安全模型 | 已采纳 |
| [ADR-0008](./ADR/ADR-0008-wait-subagent-api.md) | /runs/wait 与 managed-subagent API 双轨 | 已采纳 |
| [ADR-0009](./ADR/ADR-0009-rollback.md) | 进化版本回滚 | 已采纳 |
| [ADR-0010](./ADR/ADR-0010-template-assets.md) | 团队模板资产化 | 已采纳 |
| [ADR-0011](./ADR/ADR-0011-scheduler-and-upstream-boundary.md) | 定时巡检与上游能力接入边界 | 已采纳 |
| [ADR-0012](./ADR/ADR-0012-expert-review.md) | 专家评审与文档-实现对齐 | 已采纳 |

## 版本链管理

版本链 = 文档版本 + ADR 决策记录 + CHANGELOG 事件流 三者咬合，目标：**任何一个时刻都能回答"这个设计为什么这样、什么时候变的、当时怎么决定的"**。

```
需求/功能变更
   │
   ├─→ 更新对应文档（01~09）正文 + 版本头
   ├─→ docs/CHANGELOG.md 追加事件（日期 / 变更 / 影响文档 / 版本 / ADR）
   └─→ 需要决策记录时：docs/ADR/ADR-00NN-<slug>.md（状态：提议/已采纳/已废弃）
```

### 变更流程（每次需求/功能变更必走）

1. **定位**：判断变更影响哪些文档（跨模块则改多篇）；事实类内容只改 SSOT 主场。
2. **改文档**：更新正文 + 版本头（SemVer 语义，见下）。
3. **记日志**：`docs/CHANGELOG.md` 顶部插入一条，含日期、变更摘要、影响的文档/版本、ADR 引用。
4. **重要决策**：新建或更新 ADR，记录背景、方案对比、结论。
5. **代码同步**：若变更涉及代码，代码注释与契约以本文档为准。

### 版本语义（SemVer 约束在文档层）

- **major**：架构级变更（融合契约不兼容、部署拓扑变化、数据模型破坏性迁移）。
- **minor**：功能级新增/调整（新增团队模板、新增进化目标、新增安全策略项）。
- **patch**：说明修正、澄清、拼写/口径统一，不含行为变化。

> 文档版本与代码版本相互独立：文档版本记录"设计事实"的演进；代码版本在 `CHANGELOG.md` 中建立对应关系。

## 快读

- 想 5 分钟跑起来：读 [09-上手指南](09-guides.md)。
- 想 30 秒了解产品：读 [01-愿景与定位](01-vision.md)。
- 想了解架构与融合：读 [03-系统架构](03-architecture.md) + [04-融合桥契约](04-fusion-contract.md)。
- 想看最近变化：读 [CHANGELOG](CHANGELOG.md)。
- 想看历史决策：读 [ADR 索引](#adr-索引)。
