# 06 · 团队模板（Team Templates）

| 项 | 值 |
|---|---|
| **版本** | v1.5.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0006、ADR-0010、ADR-0011 |
| **变更摘要** | P5/P6 收口：模板市场（一键导入副本）；定时巡检执行历史 UI |

## 定位

团队模板是**业务资产**——把"一支运营团队怎么组织、怎么干活"固化为一组可运行配置，是两个上游都没有的产品层资产。用户选模板即得一支可运行、可进化、可改组的数字团队。

## 模板模型

每个团队模板 = 三要素：

```
soul       主代理（orchestrator）人设：职责、工作方式、成员清单占位 {team_members}
members    成员清单（penguin Agent 的 agent_id 列表；None = 全部 Agent 入队）
workflows  预设工作流任务 [{id, label, task}]——task 即"该工作流的评测语句"
```

## 内置模板

### 跨境电商（5 个）

| 模板 | icon | 成员 | 工作流 | 场景 |
|---|---|---|---|---|
| **crossborder-ops** | 🌏 | 全部入队 | 日常巡检 / 周报 / 大促策划 | 全平台运营总监 |
| **amazon-ops** | 🛒 | pricing/ad/listing/inventory/customer/compliance/analyst | Listing 优化 / 广告复盘 / 补货预测 / 竞品监控 | Amazon 专项 |
| **tiktok-shop** | 🎵 | sourcing/content/ad/analyst | 内容周计划 / 达人合作 / GPM 复盘 | TikTok Shop 内容电商 |
| **content-studio** | ✍️ | sourcing/content/listing | 商品页文案 / 短视频脚本 / 品牌故事 | 内容工厂 |
| **ops-support** | 📦 | logistics/customs/tax/finance/compliance | 物流方案 / 关税合规 / 退税核算 | 履约财税 |

### 通用（3 个，P3 新增）

| 模板 | icon | 成员 | 工作流 | 场景 |
|---|---|---|---|---|
| **research-ops** | 🔬 | researcher/analyst | 市场调研 / 竞品分析 | 研究分析团队 |
| **support-ops** | 🎧 | customer_reply/analyst | 工单分诊 / 客服话术 | 客户支持团队 |
| **dev-ops** | 💻 | developer/reviewer | 技术方案 / 代码审查 / 缺陷分析 | 软件开发团队 |

> ⚠️ **通用模板的前置条件与诚实边界（评审 P1-3/P1-4）**：
> - 成员 id 需在 penguin 侧存在同名 Agent（researcher/analyst/customer_reply/developer/reviewer）；不存在时被过滤，**团队可能只剩主代理（"空壳团队"）**，多智能体编排退化。penguin 默认不预置这些 Agent，需自建。
> - 3 个通用模板**当前无专属评测用例**（进化时仅通用用例覆盖，改进与场景相关性有限；专属用例待补）。
> - 定位：验证团队模型不绑定跨境领域（引擎通用性证明 + 生态示例），不作为独立 GTM 方向（见 01-vision）。

## 模板资产化（P3/P5）

模板可导出为 JSON 资产、导入后立即可用（内置 + 自定义合并，自定义同名覆盖内置）。

```http
GET  /api/fusion/team/templates                  # 列表（含 custom / version 标记）
GET  /api/fusion/team/templates/{name}/export    # 导出资产 JSON（developer）
POST /api/fusion/team/templates/import           # 导入自定义模板（admin）
GET  /api/fusion/team/templates/{name}/versions  # 版本历史（developer）
POST /api/fusion/team/templates/{name}/rollback  # 回填到历史版本（admin）
GET  /api/fusion/team/templates/market           # 模板市场索引（developer）
```

- **存储**：自定义模板存 `gateway/config/team_templates/<name>.json`（原子写，可入库分享）。
- **校验**：导入需含 `name` / `soul` / `workflows`（每项含 id/label/task）；`name` 为内置名时拒绝（409），避免覆盖内置。
- **生效**：自定义模板与内置等价参与 team sync / run / 进化（统一模板解析入口）。
- **来源标记**：导入可带 `source`（如 `community` / URL），随资产保留，便于共享追溯。
- **⚠️ 供应链提示（评审 P1-8）**：导入的模板是**不可信输入**——soul 会原样成为主代理 system prompt（当前无长度上限与来源包装，penguin 同步路径反而有）。只导入可信来源的模板；能力增强（包装+截断）见 docs/07 已知缺口。

**最小可导入示例**：

```json
{
  "name": "my-team",
  "icon": "🧭",
  "description": "我的自定义团队：一句话说明",
  "members": ["agent_id_1", "agent_id_2"],
  "soul": "你是……主编（主代理人设）。\n\n当前团队成员（按需分派）：\n{team_members}\n\n风格：简洁、专业。",
  "workflows": [
    { "id": "wf1", "label": "示例工作流", "task": "具体任务描述……" }
  ],
  "source": "community"
}
```

### 版本管理（P5）

- 二次导入同名模板 → 版本号 +1，旧版本快照归档到 `<name>.history.json`（原子写）。
- 模板 JSON 记 `version` / `updated_at`；列表与导出均含版本号。
- `GET /team/templates/{name}/versions` 返回当前版本 + 历史（version / updated_at / description）。
- **回填**：`POST /team/templates/{name}/rollback` `{version}`（admin）——归档当前版本，把历史快照写回为新版本（内置模板不可回填）。

### 模板库 · 一键副本（评审更名：原"模板市场"）

> 当前为**内置模板目录 + 一键复制副本**，无第三方分发（共享仓库为远期方向，见 08-roadmap）。

- `GET /team/templates/market` 返回全部内置模板的可导入资产目录，`installed` 标记是否已有同名自定义副本。
- Studio「🛒 市场」面板一键"导入副本"（默认名 `<name>-copy`，`source` 记 `market:<原模板>`）——内置模板只读不可覆盖，副本可自由修改、导出、分享。

## 定时团队巡检（P4）

把团队工作流注册为 DeerFlow 定时任务，按 cron/interval 自动执行（契合跨境日常运营巡检）。

```http
POST   /api/fusion/team/schedule                     # 创建定时巡检（developer）
GET    /api/fusion/team/schedules                    # 列表
POST   /api/fusion/team/schedules/{id}/pause|resume|trigger   # 暂停/恢复/立即触发
DELETE /api/fusion/team/schedules/{id}               # 删除（admin）
GET    /api/fusion/team/schedules/{id}/runs          # 执行历史（P6）
```

- **绑定**：`assistant_id` = 该团队主代理（`dh-orchestrator-<team>`），创建前自动同步主代理。**前置条件：需先执行过团队 sync（当前 schedule 仅同步主代理，不同步成员子代理——成员从未 sync 时定时任务触发无子代理可分派，评审 P2-6）。**
- **⚠️ 安全考量**：定时任务把 prompt 持久化到 DeerFlow 由上游周期触发，**绕开网关成本护栏**且 prompt 无审查即持久化、developer 可注册高频 cron——护栏与缓解措施见 docs/07「定时巡检」。
- **任务内容**：`prompt` 默认取工作流 task（经 `get_effective_workflow_task` 合并进化产物）。
- **DeerFlow 侧**：代理 `POST /api/scheduled-tasks`（`schedule_type` once/cron/interval + `schedule_spec` + `timezone`）。
- **PAT 增量授权**：定时任务需 `threads:write`（除已有 `threads:read` / `runs:create` / `runs:read`）。

## 编排模型

- 主代理（orchestrator）通过 `task` 工具按名动态分派子任务给成员（可并行），汇总结果。
- 成员经 `_write_subagents_config` 写入 DeerFlow 2.X `subagents.custom_agents`。
- 进化产物（soul / member_prompt / workflow_task 覆盖）在运行时合并进模板基础值。

## 演进方向

| 方向 | 状态 | 说明 |
|---|---|---|
| 团队级专属评测用例 | ✅ 完成 | 全部 5 团队均有专属用例（见 05-evolution「评测用例」） |
| 模板导入/导出/分享 | ✅ 完成 | JSON 资产 + 导入/导出 API + Studio UI（P3） |
| 跨平台通用模板 | ✅ 完成 | research-ops / support-ops / dev-ops（P3） |
| 定时团队巡检 | ✅ 完成 | DeerFlow Scheduler 接入（P4） |
| 模板版本管理 | ✅ 完成 | 版本号 + 历史归档 + versions API（P5） |
| 模板版本回填 | ✅ 完成 | rollback API + Studio 版本面板（P5） |
| 模板来源标记 | ✅ 完成 | 导入 `source` 字段随资产保留（P5） |
| 定时巡检执行历史 | ✅ 完成 | `GET /team/schedules/{id}/runs` + Studio 历史 UI（P6） |
| 模板市场 | ✅ 完成 | 市场索引 + 一键导入副本（P5 收口） |
| Machines 状态 | ✅ 完成 | Monitor 页只读展示（`GET /api/dashboard/machines`） |

## 相关文档

- 产品形态：[02-产品设计](02-product.md)
- 进化：[05-进化引擎](05-evolution.md)
- 路线图：[08-路线图](08-roadmap.md)
- 决策：[ADR-0006](./ADR/ADR-0006-team-templates.md)
