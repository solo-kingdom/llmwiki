## Why

功能对齐分析（`docs/14-gap-analysis-and-roadmap.md`）识别出工作区脚手架与 Karpathy 原始 LLM Wiki 及参考实现存在多处 gap，而项目当前以**中文为主**、**Web UI + MCP 双入口**、**尚无真实 workspace** 的开发阶段，需要先把「第一次 `llmwiki init` 就能代表正确结构」作为 Sprint 1 基础。

当前问题：

1. **`wiki/index.md` 缺失**：文档与 README 描述存在该文件，但 `llmwiki init` 不创建；`reindex` 也不自动生成。MCP Agent 与 Web Reader 缺少 Karpathy 定义的「内容目录」导航层。
2. **Wiki 子目录不完整**：仅创建 `entities/`、`concepts/`、`sources/`，缺少 `synthesis/`、`comparisons/`、`queries/`。
3. **引导文件过于空白且为英文**：与默认 `doc_language=zh` 不一致，LLM 冷启动缺少结构化引导。
4. **Obsidian 兼容缺配置**：wikilink + YAML frontmatter 已兼容，但无 `.obsidian/` 自动生成，用户需手动配置。

在尚无真实数据的工作区开发阶段，这些 gap 会阻塞端到端测试闭环，并导致文档预期与代码行为不一致。

## What Changes

- **补全 workspace 目录结构**：init 时创建 6 个 wiki 子目录 + `raw/assets/`（与 nashsu/Skilled 对齐）。
- **新增中文引导 scaffold**：`purpose.md`、`wiki/overview.md`、`wiki/log.md` 使用中文模板，含 YAML 结构化字段与 init 首条 log 条目。
- **新增 `wiki/index.md` 脚手架**：init 创建按类型分组的中文空表格框架。
- **reindex 自动生成 `wiki/index.md`**：从 wiki 页面 frontmatter 幂等重建内容目录（类似 LLM-Wiki-Skilled 的 `rebuild_index.py`）。
- **init 自动生成 `.obsidian/` 基础配置**：`app.json` 等最小 Obsidian 兼容配置。
- **init 幂等补全**：已初始化 workspace 再次执行 init 时，补全缺失目录与 scaffold 文件（不覆盖已有内容）。

## Scope

### In Scope

- `cmd/llmwiki/init.go` 目录列表、scaffold 模板、Obsidian 配置嵌入。
- `internal/engine/` 新增 index 重建逻辑，集成到 `Reindexer.Rebuild()`。
- 更新 `workspace-management` 与 `cli-interface` spec delta。
- 单元测试：init 目录/scaffold、index 重建、reindex 集成。

### Out of Scope

- 摄入完成后自动更新 index（留给后续 change，可在 ingest pipeline 调用同一 rebuild 函数）。
- `llmwiki lint --check-index` 索引过时检测（留给 lint change）。
- 页面合并保护、job SHA256 缓存、CJK 分词（后续 Sprint change）。
- `wiki/templates/` 页面模板系统。
- `raw/README.md` 策略说明文件。

## Capabilities

### New Capabilities

- `wiki-index-generation`: 从 wiki 页面 frontmatter 幂等生成 `wiki/index.md`，init 脚手架 + reindex 集成。

### Modified Capabilities

- `workspace-management`: 扩展 init 目录结构、中文 scaffold、Obsidian 配置、reindex 时 index 重建。
- `cli-interface`: 更新 init 命令预期输出目录列表。

## Impact

- **Backend**: `cmd/llmwiki/init.go`、`internal/engine/reindex.go`、新增 `internal/engine/index_builder.go`（或同等模块）。
- **Frontend**: 无 UI 变更；Web Reader 文件树将自然展示新目录与 index.md。
- **MCP**: `guide` 工具可引用 index.md 作为导航入口（可选文档更新，非必须改代码）。
- **Data**: 无 DB schema 变更；`wiki/index.md` 为 FileTruth 产物。
- **Testing**: 新增 init 与 index builder 测试；扩展 reindex 测试。

## Risks

- reindex 末尾写入 `wiki/index.md` 可能触发 file watcher 二次索引；需复用现有 self-write 保护或标记系统写入。
- 已初始化 workspace 的 scaffold 补全不能覆盖用户/LLM 已编辑的文件。
- index 生成格式需与后续 lint 契约保持一致，避免重复定义。
