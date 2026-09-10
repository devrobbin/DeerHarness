# 01 · 愿景与定位

| 项 | 值 |
|---|---|
| **版本** | v1.0.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0001（产品定位） |
| **变更摘要** | 初始成稿：确立"以 Agent 团队为单位的本地优先协同进化平台"定位 |

## 一句话定位

> **DeerHarness 是一个"以 Agent 团队为单位"的本地优先协同进化平台。**

它把 **PenguinHarness 的 Agent 生产与自进化能力**、**DeerFlow 2.X 的多智能体运行时**接起来，让用户**用一句话描述业务团队，系统自动组队、真实运行、评测、改进、再运行**——循环直到团队达到业务目标分，全程有人工审批把关、有成本护栏、有版本可回滚。

## 解决的问题

| 痛点 | 现有方案做不到 | DeerHarness 的答案 |
|---|---|---|
| Agent 开发成本高、迭代慢 | 手写 prompt / 反复调参 | 一句话生成团队，评估→改进闭环自动迭代 |
| 长链路多智能体协作易失忆、上下文混乱 | 单 Agent 或简单编排 | DeerFlow 2.X 运行时：沙箱 / 记忆 / 子代理 / 持久化 |
| 单 Agent 优化会破坏团队协作协议 | 逐 Agent 单独进化 | **团队级协同进化**：以团队为单位联合进化（版本一致性） |
| AI 自我改进不可控 | 全自动进化无守门 | 人工审批门 + 负面样本记忆 + 验证轮 |
| 成本不可预期 | 无成本意识 | 真实 token 计价 + max_cost / token_budget 护栏 |

## 价值主张（Value Propositions）

1. **团队即产品单位**：5 个跨境电商团队模板开箱即用，可运行时改组、按需扩展。
2. **自进化但有人守门**：评估→改进→审批→应用→复测闭环，进化不失控。
3. **真实运行而非演示**：融合桥把 penguin 定义同步为 DeerFlow 2.X 运行时子代理，真沙箱、真工具、真成本。
4. **成本与安全是内建护栏**：RBAC、max_rounds / max_cost / blocked_domains、token_budget 硬顶。
5. **可追溯可回滚**：每版配置快照 + 版本对比曲线 + ADR 决策记录。

## 目标用户

- **跨境电商运营者**（初始场景）：需要 Amazon / TikTok Shop / 内容 / 履约财税的"运营团队数字分身"。
- **Agent 平台开发者**：需要把"Agent 生产"与"Agent 运行时"缝合，并自带进化闭环的参考实现。
- **技术决策者**：评估本地优先、自进化的多智能体平台的团队。

## 非目标（Non-Goals）

- 不替代 PenguinHarness 的 Agent 生产 / 不替代 DeerFlow 的运行时本身——而是**编排与进化层**。
- 不做公有云 SaaS（初始定位为本地优先 / 自托管）。
- 不做通用低代码平台（聚焦"团队编排 + 进化"这一纵深）。

## 与上游的关系（DeerFlow 2.X 为既定基准）

| 上游 | 定位 | 本项目消费的能力 |
|---|---|---|
| **PenguinHarness** | Agent 工厂 + 训练场 | Agent 定义（system prompt / tools）、benchmark、Machines（机器农场，远期） |
| **DeerFlow 2.X** | Super Agent Harness（运行时） | threads / runs（含 wait + Idempotency-Key）、subagents、sandbox、PAT 认证、token_budget、scheduler（远期） |

> **约定：DeerFlow 以 2.X 为基准。** 融合桥按 2.X 契约（PAT + 幂等 + 编程式子代理 API）实现；对旧版 OAuth2 表单登录仅保留兼容回退，不作为设计基准。

## 相关文档

- 产品形态：[02-产品设计](02-product.md)
- 架构落地：[03-系统架构](03-architecture.md)
- 融合契约：[04-融合桥契约](04-fusion-contract.md)
- 路线图：[08-路线图](08-roadmap.md)
