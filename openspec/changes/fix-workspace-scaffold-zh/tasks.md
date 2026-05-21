## 1. Scaffold 模板与目录常量

- [ ] 1.1 在 `internal/engine/` 新增 scaffold 常量（中文 `purpose.md`、`overview.md`、`log.md`、空 `index.md` 框架）
- [ ] 1.2 定义完整目录列表常量（6 wiki 子目录 + `raw/assets/` + `.obsidian/` + 既有目录）
- [ ] 1.3 定义 Obsidian 最小配置内容（`app.json`）
- [ ] 1.4 抽取 `writeIfNotExists(path, content)` 辅助函数供 init 复用

## 2. Index Builder 实现

- [ ] 2.1 新增 `internal/engine/index_builder.go`：`IndexBuilder` 结构体
- [ ] 2.2 实现 wiki 子目录扫描（6 类 + 排除 index/log/overview）
- [ ] 2.3 实现 frontmatter 解析（title、description、date）与表格行生成
- [ ] 2.4 实现 wikilink 列格式：`[[subdir/slug|title]]`
- [ ] 2.5 实现 `BuildIndex()` 返回完整 markdown（含 YAML frontmatter + 中文 section）
- [ ] 2.6 实现 `WriteIndex()` 写入 `wiki/index.md`
- [ ] 2.7 新增 `index_builder_test.go`：空 workspace、多页面分组、frontmatter fallback、幂等性

## 3. Reindex 集成

- [ ] 3.1 在 `Reindexer.Rebuild()` 末尾调用 `IndexBuilder.RebuildIndex()`
- [ ] 3.2 reindex 完成后对 `wiki/index.md` 执行 `IndexRelPath` 确保 SQLite 索引
- [ ] 3.3 更新 `reindex_test.go`：验证 reindex 后 index.md 内容与 wiki 页面一致
- [ ] 3.4 确认 index 写入不破坏 `verifyRecovery()`（必要时调整验证顺序）

## 4. Init 命令改造

- [ ] 4.1 扩展 `cmd/llmwiki/init.go` 目录列表（synthesis/comparisons/queries/raw/assets/.obsidian）
- [ ] 4.2 写入中文 scaffold 文件（仅 missing）
- [ ] 4.3 写入 Obsidian 配置（仅 missing）
- [ ] 4.4 改造已初始化 workspace 行为：仍补全目录/scaffold，但不重建 DB
- [ ] 4.5 空子目录写入 `.gitkeep`（可选，便于 Git 追踪）
- [ ] 4.6 新增 `cmd/llmwiki/init_test.go`：目录结构、scaffold 语言、不覆盖已有文件、repair 模式

## 5. 文档与验收

- [ ] 5.1 更新 `docs/14-gap-analysis-and-roadmap.md` 中 P0-1/P0-3/P1-3/P1-4 状态说明（实现后标记）
- [ ] 5.2 手工验收：`llmwiki init /tmp/test-ws` → 检查目录、中文 scaffold、index 框架、Obsidian 配置
- [ ] 5.3 手工验收：添加 wiki 页面 → `llmwiki reindex` → index.md 条目正确
- [ ] 5.4 运行 `go test ./internal/engine/... ./cmd/llmwiki/...` 全部通过
