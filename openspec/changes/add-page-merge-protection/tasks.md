## 1. Merge 核心模块

- [ ] 1.1 新增 `internal/ingest/merge.go`
- [ ] 1.2 实现 frontmatter 解析与 `mergeFrontmatter(old, new)`
- [ ] 1.3 实现锁定字段保护（type, title, created）
- [ ] 1.4 实现数组字段 union（tags, sources, related）
- [ ] 1.5 实现 `mergeBodyLLM(ctx, old, new)` + 70% 长度 guard
- [ ] 1.6 实现 `MergeWikiPage(ctx, path, newContent, opts)` 统一入口

## 2. ApplyWikiBlocks 集成

- [ ] 2.1 改造 `fileblocks.go`：写入前调用 merge
- [ ] 2.2 Pipeline 注入 llmClient 与 docLang 到 merge
- [ ] 2.3 新增 `ForceOverwrite` pipeline 选项
- [ ] 2.4 merge 失败时 abort 整个 ApplyWikiBlocks（或单文件 fail-fast，设计时定）

## 3. 测试

- [ ] 3.1 单元测试：frontmatter 锁定与 union
- [ ] 3.2 单元测试：相同内容 skip write
- [ ] 3.3 集成测试：mock LLM merge body
- [ ] 3.4 集成测试：长度 guard 触发 error
- [ ] 3.5 集成测试：force overwrite 跳过 merge
- [ ] 3.6 验证 cache hit 路径不受影响

## 4. 文档

- [ ] 4.1 更新 docs/14 P0-2 状态
- [ ] 4.2 README 说明 merge 行为与 force 选项
