## Context

Organize 模式依赖 Local 诊断工具（`structure`、`audit`、`gaps`、`similar`）获取 wiki 真实状态。`structure` 从 SQLite `index.db` 读取已索引文档，按 `engine.TypedWikiSubdirs` 输出目录树。然而 session LLM 在 tool loop 返回后仍可能在最终回复中「总结」成通用占位树，与用户磁盘上的 typed wiki 严重偏离。

文档方面，`skills/llmwiki-guide`、`web/src/content/help.*.md`、`README.md`、`docs/12-wiki-directory-organization.md` 均描述 wiki 布局，但详略不一：help 首段树未展开 `wiki/` 子目录；无文档展示 `structure()` 真实输出格式；无集中 anti-pattern 列表。

Apply 管线方面，`engine.IndexBuilder` 仅在 `reindex` 时调用 `RebuildIndex()`。ingest/organize apply 写入或删除 wiki 页后，`wiki/index.md` 不会自动更新，用户需手动 `reindex` 才能看到最新目录表。

## Goals / Non-Goals

**Goals:**

- 单一 canonical 工作区布局文档，其他用户向文档引用或与之对齐。
- Organize prompt 强制 structure 输出保真，降低目录树幻觉。
- `structure` 工具输出更易识别（数据来源、路径前缀、空目录、系统目录标记）。
- Wiki apply 成功后自动重建 `wiki/index.md`；organize apply 涉及结构变更时追加 `wiki/log.md`。
- Apply 后确保新写入/删除的文件被 indexer 处理，索引与文件系统一致。
- `skills/` 与 `internal/ingest/prompts.go` 同步更新。

**Non-Goals:**

- 不在本 change 实现 move/merge 时的全库 wikilink 自动重写（仍由 LLM 在 generation 阶段处理；可后续独立 change）。
- 不自动重写 `wiki/overview.md`（仍由 LLM 或用户维护）。
- 不改变 typed wiki 目录集合或 lint 规则语义。
- 不新增 CLI 命令；复用现有 apply / reindex 钩子。

## Decisions

### 1. Canonical 布局文档位置

**选择**: 新增 `docs/workspace-layout.md` 作为权威源；help、skills、README 精简引用并对齐，不重复维护多份完整树。

**理由**: 避免四处修改遗漏；developer docs 适合放完整规范，help 面向用户做 distill。

**备选**: 仅改 help — 开发者文档仍分散，易再次漂移。

### 2. Organize 保真约束落地层

**选择**: 在 `StepSessionOrganize` 的中英文 task instruction 增加硬约束；同步 `skills/llmwiki-query/SKILL*.md`；可选在 organize round 0 nudge 消息中重申「引用 tool 返回原文」。

**理由**: 项目约定 skills 为 prompt 蓝本，`prompts.go` 为运行时真相；双层同步符合现有 workflow。

**备选**: 仅改 UI 展示 tool 结果 — 不解决 LLM 最终回复编造问题。

### 3. structure 工具输出增强

**选择**: 在 `executeLocalStructure` 输出头部增加：
- 工作区根路径（一行）
- 数据来源说明：`SQLite index（与文件系统不一致时请 reindex）`
- 保留现有 `# Wiki 目录结构` 标题与 typed 子目录顺序

**理由**: 最小改动，帮助 LLM 和用户识别真实数据来源；与 explore 结论一致。

**备选**: 改为扫描文件系统 — 与「索引为诊断数据源」现有设计不一致，且 empty dir 已可通过 TypedWikiSubdirs 列出。

### 4. Post-apply 维护钩子

**选择**: 在 ingest apply 成功路径（`ApplyWikiBlocks` 完成之后、job 标记 succeeded 之前）调用新 helper `engine.PostApplyMaintenance(workspace, opts)`：

1. `IndexBuilder.RebuildIndex()` — 始终执行（任何 wiki FILE/DELETE 后）
2. 若 review mode 为 `organize` 且 plan 含 move/merge/delete 动作：追加 `wiki/log.md` 条目，格式 `## [YYYY-MM-DD] organize | <summary>`
3. 通过现有 `FileIndexer` 对 `wiki/index.md`（及 log 若变更）执行 `IndexFile`

**理由**: 复用已有 `IndexBuilder`；log 追加符合仅追加契约；organize 专属 log 避免 ingest 噪声。

**备选**: 每次 apply 都写 log — ingest 频率高，会污染 log。

### 5. 文档中的 structure 样例

**选择**: 使用 anonymized 但结构真实的样例（基于 typed wiki 规范），标注「格式示例，实际页面名以 tool 返回为准」，避免绑定特定用户 workspace。

**理由**: help 为静态 bundle，不宜嵌入用户私有页面名。

## Risks / Trade-offs

- **[Risk] Index 重建增加 apply 延迟** → `BuildIndex` 为本地文件扫描，典型 workspace <100 页耗时可忽略；若失败记录 warning 但不使 apply 失败。
- **[Risk] LLM 仍可能忽略 prompt 保真约束** → 保留 organize round 0 `tool_choice=required` 与 nudge；UI 已 emit tool_done 事件，用户可对照 debug。
- **[Risk] 文档多处引用 canonical 仍可能漂移** → tasks 含「变更 checklist」：改 layout 须同步 help + skills + README。
- **[Risk] log 摘要由系统生成可能不够具体** → log 条目列出 move/merge 路径计数与 plan summary 首句，细节仍在 git timeline / job events。

## Migration Plan

1. 合并代码与文档更新，无 DB schema 变更。
2. 已有 workspace 下次 apply 起自动获得 index 重建；无需 migration。
3. 可选：维护者运行一次 `llmwiki reindex` 确保 index 与文件一致（非必须）。

## Open Questions

- move/merge 时是否在本 change 增加 **死链 wikilink 扫描提示** 写入 apply job event（不做自动修复）？建议 tasks 阶段实现为 job event，不阻塞主路径。
- `guide` MCP 工具是否也应嵌入 canonical 布局摘要？建议 yes，作为小增量 task。
