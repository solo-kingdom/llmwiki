## 1. Canonical 布局文档

- [x] 1.1 新增 `docs/workspace-layout.md`：完整工作区树、typed 子目录（复数）、系统页、templates、anti-pattern FAQ
- [x] 1.2 更新 `README.md` 工作区结构节，对齐 canonical 布局（补全 comparisons/queries/synthesis/templates）
- [x] 1.3 更新 `docs/12-wiki-directory-organization.md` §6 本项目结构，补充 `wiki/templates/` 与 workspace 根文件说明

## 2. Help 与 Skills 文档同步

- [x] 2.1 更新 `web/src/content/help.zh.md`：展开 wiki 子目录树、anti-pattern FAQ、`structure()` 输出样例、Organize 保真说明
- [x] 2.2 更新 `web/src/content/help.en.md`：与中文版等价内容
- [x] 2.3 更新 `skills/llmwiki-guide/SKILL.zh.md` 与 `SKILL.md` 工作区结构节，引用 canonical 约定
- [x] 2.4 更新 `skills/llmwiki-query/SKILL.zh.md` 与 `SKILL.md`：Organize 工作流增加 structure 输出保真约束与工具输出格式样例

## 3. Organize Prompt 防幻觉

- [x] 3.1 更新 `internal/ingest/prompts.go` 中 `StepSessionOrganize` 中英文 task instruction：禁止编造目录树，必须引用 structure 工具返回
- [x] 3.2 更新 `internal/ingest/chat_wiki_executor.go` organize nudge 消息，明确要求引用 structure/audit 原始输出
- [x] 3.3 扩展 `internal/ingest/prompts_test.go`：断言 organize prompt 含 structure 保真关键词（中英文）

## 4. structure 工具输出增强

- [x] 4.1 更新 `internal/mcp/diagnostic_tools.go` `executeLocalStructure`：输出工作区根路径与 index 数据来源说明
- [x] 4.2 确保空 typed 目录与 templates 系统标记与 `engine.TypedWikiSubdirs` 一致
- [x] 4.3 新增或扩展 diagnostic tools 测试：验证输出头格式与 typed 目录列表

## 5. Apply 后自动维护（index + log）

- [x] 5.1 在 `internal/engine/` 新增 `post_apply_maintenance.go`（或等价 helper）：`PostApplyMaintenance(workspace, opts)`
- [x] 5.2 实现 apply 成功后 `IndexBuilder.RebuildIndex()` 与 index 文件 re-index
- [x] 5.3 实现 organize apply 含 move/merge/delete 时追加 `wiki/log.md` 条目（仅追加、格式合规）
- [x] 5.4 在 ingest apply 成功路径（processor / fileblocks apply 完成后）调用 post-apply maintenance
- [x] 5.5 新增测试：apply 写入 wiki 页后 index.md 自动更新；organize move 后 log 追加；无 wiki 变更时跳过 rebuild

## 6. MCP guide 与收尾

- [x] 6.1 更新 `internal/mcp/tools.go` `guide` 工具：嵌入精简 canonical 布局摘要（typed 复数目录 + 常见 anti-pattern 一行提示）
- [x] 6.2 运行 `go test ./internal/engine/... ./internal/ingest/... ./internal/mcp/...` 确认通过
- [x] 6.3 手工验收：lwk3 organize session 首轮 structure 输出格式正确；模拟 apply 后 index.md 自动重建
