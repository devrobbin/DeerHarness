# ADR-0009 · 进化版本回滚

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [05-进化引擎](../05-evolution.md) |

## 背景

进化产物写入 `config_overrides` 后直接生效并影响团队编排。若某版本改进效果差或引入回归，需要能撤销到之前状态。原有 `set_override` 用 `ON CONFLICT DO UPDATE` 覆盖旧值，旧值不保留，无法回滚。

## 决策

1. **存储层加历史**：新增 `override_history` 表，`set_override` 每次写入前把旧值（若与现值不同）记入历史（带旧版本号 + action）。
2. **回滚 API**：`POST /tasks/{id}/rollback` `{version}`（admin）——读目标版本快照的 proposal（target/member_id/_override_version），用 `get_override_before_version` 取该键在目标版本前的最后值：
   - 有历史值 → `set_override` 写回（新版本号，可继续回滚）；
   - 无历史 → `delete_override` 删除覆盖，回退基础模板。
3. **前端**：ScoreChart 每版本行提供"回滚"按钮，确认后调用 API 并刷新版本列表。

## 后果

- 进化产物可撤销、可追溯（history 全量留痕）。
- 回滚本身也是新版本记录，版本链闭合。
- 单测覆盖：`test_evolution_store.py`（4 项：历史与回滚 / workflow_id / 回退基础模板 / 值未变化不写历史）。
