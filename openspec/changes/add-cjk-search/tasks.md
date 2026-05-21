## 1. Schema 与迁移

- [ ] 1.1 更新 `schema.sql`：`chunks_fts` 使用 `tokenize='trigram'`
- [ ] 1.2 实现 FTS 表重建 migration（检测旧 tokenizer 并 DROP/CREATE + 回填）
- [ ] 1.3 确认 modernc.org/sqlite 支持 trigram（不支持则实施 bigram 预处理 fallback 方案）

## 2. 查询逻辑

- [ ] 2.1 调整 `escapeFTSQuery()` 适配 trigram（CJK 与英文分支）
- [ ] 2.2 优化 CJK query 的 FTS 路径优先级（减少不必要的 LIKE）
- [ ] 2.3 保留 LIKE 作为零结果兜底

## 3. 测试

- [ ] 3.1 扩展 `cjk_test.go`：中文 query 必须走 FTS 且返回结果
- [ ] 3.2 英文搜索回归测试
- [ ] 3.3 混合中英文 query 测试
- [ ] 3.4 migration/reindex 后 FTS 数据完整性测试

## 4. 文档与验收

- [ ] 4.1 更新 README：升级后建议 `llmwiki reindex`
- [ ] 4.2 手工验收：Web SearchModal + MCP search 中文 query 可用
- [ ] 4.3 运行 `go test ./internal/store/sqlite/...`
