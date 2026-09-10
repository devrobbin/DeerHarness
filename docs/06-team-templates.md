# 06 · 团队模板（Team Templates）

| 项 | 值 |
|---|---|
| **版本** | v1.1.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0006 |
| **变更摘要** | P2 落地：团队专属评测用例扩充（content-studio / crossborder-ops / ops-support 补齐），全部 5 个团队均有专属用例 |

## 定位

团队模板是**业务资产**——把"一支运营团队怎么组织、怎么干活"固化为一组可运行配置，是两个上游都没有的产品层资产。用户选模板即得一支可运行、可进化、可改组的数字团队。

## 模板模型

每个团队模板 = 三要素：

```
soul       主代理（orchestrator）人设：职责、工作方式、成员清单占位 {team_members}
members    成员清单（penguin Agent 的 agent_id 列表；None = 全部 Agent 入队）
workflows  预设工作流任务 [{id, label, task}]——task 即"该工作流的评测语句"
```

## 内置模板（v1.0.0）

| 模板 | icon | 成员 | 工作流 | 场景 |
|---|---|---|---|---|
| **crossborder-ops** | 🌏 | 全部入队 | 日常巡检 / 周报 / 大促策划 | 全平台运营总监 |
| **amazon-ops** | 🛒 | pricing/ad/listing/inventory/customer/compliance/analyst | Listing 优化 / 广告复盘 / 补货预测 / 竞品监控 | Amazon 专项 |
| **tiktok-shop** | 🎵 | sourcing/content/ad/analyst | 内容周计划 / 达人合作 / GPM 复盘 | TikTok Shop 内容电商 |
| **content-studio** | ✍️ | sourcing/content/listing | 商品页文案 / 短视频脚本 / 品牌故事 | 内容工厂 |
| **ops-support** | 📦 | logistics/customs/tax/finance/compliance | 物流方案 / 关税合规 / 退税核算 | 履约财税 |

## 编排模型

- 主代理（orchestrator）通过 `task` 工具按名动态分派子任务给成员（可并行），汇总结果。
- 成员经 `_write_subagents_config` 写入 DeerFlow 2.X `subagents.custom_agents`。
- 进化产物（soul / member_prompt / workflow_task 覆盖）在运行时合并进模板基础值。

## 演进方向

| 方向 | 状态 | 说明 |
|---|---|---|
| 团队级专属评测用例 | ✅ 完成 | 全部 5 团队均有专属用例（见 05-evolution「评测用例」） |
| 模板可导入/可分享 | 🔜 规划 | 序列化为资产文件，支持导入导出 |
| 跨平台模板 | 🔜 规划 | 非跨境通用团队（研究 / 客服 / 开发） |

## 相关文档

- 产品形态：[02-产品设计](02-product.md)
- 进化：[05-进化引擎](05-evolution.md)
- 路线图：[08-路线图](08-roadmap.md)
- 决策：[ADR-0006](./ADR/ADR-0006-team-templates.md)
