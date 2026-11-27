## Wiki 如何组织

知识页按 **主题域 → 主题组 → 页面** 组织（全英文小写 kebab-case slug 路径），通过 frontmatter `type` 标识页面职责（`entity` / `concept` / `synthesis` / `comparison` / `query` / `experience` / `ledger`）。

保留的导航页：`wiki/overview.md`（全局总览）与各主题目录的 `_overview.md`（金字塔导览）。历史与操作记录由 PostgreSQL `change_sets`（时间线）与 `activity_logs`（日志）自动维护。

### 常见错误布局

以下**不是**合法 canonical 布局：`wiki/purpose.md`、`wiki/rules.md`、`wiki/raw/`、`wiki/skills/`，以及把业务页直接写在 `wiki/*.md` 顶层。

### structure() 工具输出

Organize 模式应调用 `structure()` 获取数据库实时目录树与页面计数，**必须引用 tool 原始返回，不可自行绘制示例树**。

写入已有页面时默认 **合并** 而非覆盖：锁定 frontmatter 字段、数组合并、正文由 LLM 合并（可用 CLI `--force-overwrite` 恢复覆盖行为）。每次变更会自动记录 `change_sets` 与 `page_revisions`。
