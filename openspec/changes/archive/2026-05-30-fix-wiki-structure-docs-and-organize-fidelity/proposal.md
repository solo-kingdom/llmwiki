## Why

Organize 模式下 LLM 在声称「已调用 structure 工具」后，仍可能输出与真实 wiki 不符的目录树（如 `wiki/skills/`、单数 `entity/`、wiki 内的 `raw/` 等占位结构），导致重组建议基于幻觉而非索引数据。与此同时，项目内 wiki 目录规范分散在 README、help、skills、docs 多处，表述不一致且缺少 `structure()` 工具输出样例；wiki 重组 apply 后 `index.md` 等系统页也仅在 `reindex` 时重建，无法及时反映 move/merge 变更。

## What Changes

- 建立 **单一权威** 的工作区 / wiki 目录规范（canonical schema），并在 help、skills、README、docs 中统一引用，明确常见错误模式（FAQ）。
- 在 `llmwiki-query` skill 与 help 页补充 **`structure()` 工具真实输出样例**，便于用户与 LLM 对照识别编造内容。
- 加强 **Organize session prompt**（中英文）：展示目录结构时必须引用 `structure` 工具原始返回，禁止自行绘制示例树或使用占位文件名。
- 增强 **`structure` 工具输出**：标注数据来源（index.db）、工作区根路径、空目录与系统目录区分，与 `TypedWikiSubdirs` 保持一致。
- **Apply 后自动维护系统页**：ingest/organize apply 成功写入 wiki 后，自动重建 `wiki/index.md`；organize apply 涉及 move/merge/delete 时追加 `wiki/log.md` 条目并触发索引更新。
- 同步 `skills/` 与 `internal/ingest/prompts.go`，保持 prompt 行为与文档一致。

## Capabilities

### New Capabilities

- `wiki-post-apply-maintenance`: Apply 管线在 wiki 文件变更后自动重建 index、追加 organize 结构变更日志、确保索引与文件系统一致。

### Modified Capabilities

- `help-page`: 工作区结构章节展示完整 canonical 树、anti-pattern FAQ、`structure()` 输出样例。
- `ingest-session-api`: Organize 模式 session prompt 与 tool-loop 行为要求结构展示保真（引用 tool 返回，禁止编造）。
- `workspace-prompt-profile`: StepSessionOrganize 增加 structure 输出保真约束，skills 与 Go prompt 同步。
- `typed-wiki-organization`: 补充文档层面对 typed 目录命名（复数）、系统页与 templates 位置的规范说明引用点。

## Impact

- **文档**: `web/src/content/help.{zh,en}.md`、`skills/llmwiki-{guide,query}/*`、`README.md`、`docs/12-wiki-directory-organization.md`、新增或引用 `docs/workspace-layout.md`（canonical）。
- **Prompts**: `internal/ingest/prompts.go`（StepSessionOrganize）、`skills/llmwiki-query/SKILL*.md`。
- **MCP / 诊断**: `internal/mcp/diagnostic_tools.go`（structure 输出格式）。
- **Apply 管线**: `internal/ingest/fileblocks.go` 或 processor apply 钩子、`internal/engine/index_builder.go` 集成。
- **测试**: prompt 测试、structure 输出测试、apply 后 index/log 自动更新测试。
