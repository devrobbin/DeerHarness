# ADR-0010 · 团队模板资产化

| 项 | 值 |
|---|---|
| **状态** | 已采纳（2026-09-10） |
| **影响文档** | [06-团队模板](../06-team-templates.md)、[04-融合契约](../04-fusion-contract.md) |

## 背景

团队模板是产品核心业务资产，但此前仅硬编码在 `fusion.py` 的 `TEAM_TEMPLATES` 字典中——用户无法新增/分享团队，模板也全是跨境场景。

## 决策

1. **自定义模板存储**：`gateway/config/team_templates/<name>.json`（原子写、可入库分享）。
2. **合并读取**：`_all_templates()` / `_get_template()` 返回内置 + 自定义合并，自定义同名覆盖内置；所有引用点（team sync / run / 进化 / workflow 解析）统一走 `_get_template`。
3. **导入/导出 API**：`GET /team/templates/{name}/export`（developer）、`POST /team/templates/import`（admin，校验 name/soul/workflows，内置名冲突返回 409）。
4. **通用模板**：新增 research-ops（研究）/ support-ops（客服）/ dev-ops（软件开发）3 个非跨境内置模板。
5. **前端**：Studio 团队区加"导入模板 / 导出"按钮（文件选择 + 下载 JSON）。

## 后果

- 团队模板成为可分享、可扩展的资产；用户可导入他人模板。
- 内置模板只增不改（导入同名内置被拒），保证内置行为稳定。
- 后续演进：模板版本管理 / 模板市场（roadmap）。
