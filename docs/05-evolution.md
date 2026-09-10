# 05 · 进化引擎（Evolution Engine）

| 项 | 值 |
|---|---|
| **版本** | v1.1.0 |
| **更新时间** | 2026-09-10 |
| **关联 ADR** | ADR-0005、ADR-0009 |
| **变更摘要** | P2 落地：团队专属评测用例扩充；token_budget 成本护栏（evolution_token_budget）；版本回滚 API + 前端一键回滚 |

## 定位

进化引擎是产品从"管理工具"升级为"自进化系统"的灵魂：**让 Agent 团队越用越强，但每次自我改进都有人工守门、有成本护栏、可回滚**。

## 三层进化目标

| 层级 | 目标 | 评测方式 | 可改进对象 |
|---|---|---|---|
| **Agent 级** | 单 agent | dh-benchmark 通用用例 | agent 系统提示（写回 penguin config） |
| **工作流级** | {团队, 工作流} | 该工作流 task 作为评测语句 + 通用用例 | workflow.task 模板文本 |
| **团队级** | {团队} | 团队专属用例 + 通用用例 | 主代理 soul + 成员人设（member_prompt） |

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

### 审批门（Human-in-the-loop）

- `POST /tasks/{id}/approve`：应用改进 + 标记 `pending_verify` → 下一轮为**验证轮**（只复测不再生成新方案，保证改进被评测）。
- `POST /tasks/{id}/reject`：跳过本方案，**记录负面样本**（reason 摘要），下一轮 LLM"请勿重复或近似重复"。
- 需 admin 权限；approval 必须属于该任务（防跨任务误置位）。

### 应用与版本

- 产物写入 `config_overrides`：`workflow_task` / `soul` / `member_prompt`，按团队/工作流/成员唯一键。
- fusion 读取时"基础模板 + 覆盖"合并 → **进化产物立即被团队编排使用**。
- 每版本保存配置快照（`evolution_versions`），可追溯、可回滚（ScoreChart 版本对比数据源）。
- agent 型进化直接写回 penguin agent config（下次 `_sync_agent` 同步生效）。

### 版本回滚（P2）

- `POST /tasks/{id}/rollback` `{version}`：撤销指定版本应用的改进，恢复该配置键在此前生效的值（admin）。
- 存储层 `override_history` 记录每次写入前的旧值（含 action: set / rollback），`get_override_before_version` 定位目标版本前的值。
- 有历史值 → 写回（新版本号）；无历史（覆盖从未改过）→ 删除覆盖，回退基础模板。
- 前端 ScoreChart 每版本行提供"回滚"按钮，回滚后版本列表自动刷新。

### 护栏（从安全设置读取）

| 护栏 | 配置项 | 默认 |
|---|---|---|
| 轮次上限 | `max_evolution_rounds` | 10 |
| 单任务成本上限 | `max_cost_per_evolution` | $5.0 |
| 人工审批门 | `require_human_approval` | true |
| 禁入领域 | `blocked_domains` | [] |
| **子代理 token 预算（DeerFlow 2.X）** | `evolution_token_budget` | None（不限） |

成本按真实 token 计价（`_estimate_run_cost`）+ 每轮估算增量（case 执行 + 评分）；DeerFlow 2.X `token_capped` 信号计入成本。轮次/成本超限即 `stopped`。

**token_budget 护栏（P2）**：启用 `evolution_token_budget` 后，单轮任一 case 触发 `subagent_stop_reason=token_capped`（2.X 子代理 token 硬顶）即提前停止，避免被截断结果被误判为达标。

## 状态机

```
running ──→ waiting_approval（有方案待批）
   │              │ approve ──→ running（标记 pending_verify → 验证轮）
   │              └ reject  ──→ running（记录负面样本，继续下一轮）
   ├──→ success（达标 / 轮次上限 / 无低分项 / 验证完成）
   ├──→ stopped（成本超限 / 手动停止）
   └──→ failed（执行异常）
```

- 进程重启：`reconcile_stale_tasks` 续跑 running 任务；waiting_approval 保持等待（审批数据持久化）。
- 任务级互斥锁：防 approve/reject/start 并发触发双轮执行。

## 评测用例

- 通用内置集：`dh-benchmark`（信息摘要 / Markdown 格式 / JSON 输出 / Amazon listing / ACoS / TikTok 选品）。
- 团队专属（P2 扩充）：`_TEAM_CASES` 按团队映射——
  - amazon-ops：AMZ-001-listing、AMZ-002-acos
  - tiktok-shop：TT-001-sourcing
  - content-studio：CS-001-short-video、CS-002-listing-copy、AMZ-001-listing
  - crossborder-ops：XB-001-daily-inspection、AMZ-001-listing、TT-001-sourcing
  - ops-support：OPS-001-logistics、OPS-002-tax-rebate
- workflow 级：工作流 task 本身即评测语句。

## 相关文档

- 产品形态：[02-产品设计](02-product.md)
- 融合执行：[04-融合桥契约](04-fusion-contract.md)
- 安全护栏：[07-安全与护栏](07-safety.md)
- 决策：[ADR-0005](./ADR/ADR-0005-evolution-loop.md)、[ADR-0009](./ADR/ADR-0009-rollback.md)
