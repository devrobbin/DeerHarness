# 05 · 进化引擎（Evolution Engine）

| 项 | 值 |
|---|---|
| **版本** | v1.2.0 |
| **更新时间** | 2026-09-11 |
| **关联 ADR** | ADR-0005、ADR-0009、ADR-0012 |
| **变更摘要** | 专家评审修订：本篇为护栏配置 SSOT 主场；披露 max_rounds/token_budget/验证轮/DEEPSEEK 依赖的实现语义；补 stop 端点 |

## 定位

进化引擎是产品从"管理工具"升级为"自进化系统"的灵魂：**让 Agent 团队越用越强，但每次自我改进都有人工守门、有成本护栏、可回滚**。

> **护栏配置的 SSOT 主场在本篇**（docs/07 只保留 RBAC 与凭据），其他文档引用不复制。

## 三层进化目标

| 层级 | 目标 | 评测方式 | 可改进对象 |
|---|---|---|---|
| **Agent 级** | 单 agent | dh-benchmark 通用用例 | agent 系统提示（写回 penguin config） |
| **工作流级** | {团队, 工作流} | 该工作流 task 作为评测语句 + 通用用例 | workflow.task 模板文本 |
| **团队级** | {团队} | 团队专属用例 + 通用用例 | 主代理 soul 或成员人设（单点方案，见"诚实边界"） |

> **诚实边界（评审 ADR-0012）**：每轮 LLM 只生成**一个**改进方案（workflow_task / soul / member_prompt 三选一）——评测是团队级真实运行，改进是单点。多目标联合改进（bundle proposal）为远期方向。

## 闭环流程

```
启动（POST /api/evolution/start）
   → 每轮：
      1. 评估：真实运行评测用例（fusion 管道 / 团队模式子代理执行）→ LLM 评分
      2. 达标判断：avg_score ≥ target_score → 成功结束
      3. 改进：LLM 生成结构化方案 {target, member_id, new_text, reason}（受 blocked_domains 过滤）
      4. 审批门：require_human_approval=true → 入审批队列（waiting_approval）；
                false → 自动应用
      5. 应用：写 config_overrides（新版本）→ 标记验证轮 → 复测
   → 结束条件：达标 / 轮次上限 / 成本上限 / 无低分项 / 手动停止
```

## 关键机制

### 审批门与任务控制（Human-in-the-loop）

- `POST /tasks/{id}/approve`：应用改进 + 标记 `pending_verify` → 下一轮为**验证轮**。
- `POST /tasks/{id}/reject`：跳过本方案，**记录负面样本**（reason 摘要，上限 10 条），下一轮 LLM"请勿重复或近似重复"。
- `POST /tasks/{id}/stop`：手动停止（终态 `stopped`；与成本超限停止同态）。
- `POST /tasks/{id}/rollback`：回滚到指定版本（见"版本回滚"）。
- approve/reject 需 admin 权限；approval 必须属于该任务（防跨任务误置位）。

### 验证轮语义（如实披露，评审 P1-4）

验证轮的目的是**保证改进被真实评测**（分数记录进版本曲线），但当前实现**不阻断流程**：验证轮无论分数高低都以 success 结束，**不会因回归自动触发回滚或下一轮改进**。改进是否有效请查看 ScoreChart 版本对比 + 必要时手动回滚（联动 ADR-0009）。"验证轮低分 → 提示回滚"为待实现增强。

### 应用与版本

- 产物写入 `config_overrides`：`workflow_task` / `soul` / `member_prompt`，按团队/工作流/成员唯一键。
- fusion 读取时"基础模板 + 覆盖"合并 → **进化产物立即被团队编排使用**。
- 每版本保存配置快照（`evolution_versions`）+ 写入前旧值留痕（`override_history`），可追溯、可回滚。
- agent 型进化直接写回 penguin agent config（下次同步生效）。

### 版本回滚（P2）

- `POST /tasks/{id}/rollback` `{version}`：撤销指定版本应用的改进，恢复该配置键在此前生效的值（admin）。
- 有历史值 → 写回（新版本号）；无历史（覆盖从未改过）→ 删除覆盖，回退基础模板。
- 前端 ScoreChart 每版本行提供"回滚"按钮，回滚后版本列表自动刷新。

### 护栏（SSOT：从安全设置读取）

| 护栏 | 配置项 | 默认 | 实现语义（如实披露） |
|---|---|---|---|
| 轮次上限 | `max_evolution_rounds` | 10 | ⚠️ 当前**实际不生效**：启动请求的 max_rounds 永非零，Settings 值被短路（应改 `min(task, safety)` 语义，待修）。实际轮次由启动参数决定（1-20） |
| 单任务成本上限 | `max_cost_per_evolution` | $5.0 | 轮首检查累计成本；单轮内超支不中断 |
| 人工审批门 | `require_human_approval` | true | false 时自动应用 |
| 禁入领域 | `blocked_domains` | [] | 启发式：大小写敏感子串匹配、仅生成阶段过滤、可同义绕过——**最终防线是审批门** |
| 子代理 token 预算 | `evolution_token_budget` | None | ⚠️ 当前为**本地开关**：仅控制"触顶即停"是否启用，数值**不下发** DeerFlow（2.X token_budget 需在 DeerFlow 侧配置）；触发 `token_capped` 即提前停止该任务 |

成本 = run 级真实用量计价 + 评分增量估算。**已知缺口**：请求级对话预算（MAX_COST_PER_REQUEST）当前仅覆盖流式 chat，非流式/团队 run 绕过（见 docs/07）。

### 评分依赖（DEEPSEEK_API_KEY，评审 P2-7）

- 评分与改进建议都依赖 `DEEPSEEK_API_KEY`；**未配置时所有用例记 0 分、改进生成返回 None → 任务以 0 分"success"结束**（有误导性）。
- 处理：配置 key 后再使用进化；改进建议（待实现）：start 时无 key 直接拒绝。

## 状态机

```
running ──→ waiting_approval（有方案待批）
   │              │ approve ──→ running（标记 pending_verify → 验证轮）
   │              └ reject  ──→ running（记录负面样本，继续下一轮）
   ├──→ success（达标 / 轮次上限 / 无低分项 / 验证完成——注意验证轮不看分数）
   ├──→ stopped（成本超限[轮首检查] / token_capped / 手动停止）
   └──→ failed（执行异常）
```

- 进程重启：`reconcile_stale_tasks` 续跑 running 任务；waiting_approval 保持等待。
- 任务级互斥锁：防 approve/reject/start 并发双轮执行——**仅单进程内有效**（多 worker 部署不成立，见 docs/03 限制与风险）。

## 评测用例

- 通用内置集：`dh-benchmark`（信息摘要 / Markdown 格式 / JSON 输出 / Amazon listing / ACoS / TikTok 选品）。
- 团队专属（内置映射）：5 个跨境团队均有专属用例——
  - amazon-ops：AMZ-001-listing、AMZ-002-acos
  - tiktok-shop：TT-001-sourcing
  - content-studio：CS-001-short-video、CS-002-listing-copy、AMZ-001-listing
  - crossborder-ops：XB-001-daily-inspection、AMZ-001-listing、TT-001-sourcing
  - ops-support：OPS-001-logistics、OPS-002-tax-rebate
- **3 个通用模板（research/support/dev-ops）当前无专属用例**（⬜ 待补，评审 P1-4），进化时仅通用用例覆盖——改进与场景相关性有限。
- workflow 级：工作流 task 本身即评测语句。

## 相关文档

- 产品鸟瞰：[02-产品设计](02-product.md)
- 融合执行：[04-融合桥契约](04-fusion-contract.md)
- 已知缺口（RBAC/预算绕过）：[07-安全与护栏](07-safety.md)
- 决策：[ADR-0005](./ADR/ADR-0005-evolution-loop.md)、[ADR-0009](./ADR/ADR-0009-rollback.md)、[ADR-0012](./ADR/ADR-0012-expert-review.md)
