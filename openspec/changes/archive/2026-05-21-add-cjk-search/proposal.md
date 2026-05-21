## Why

项目以中文为主，但 FTS5 当前使用 `tokenize='porter unicode61'`，对 CJK 文本几乎不分词。现有 LIKE fallback 仅作兜底，无法提供 BM25 排序与高效召回。Web 搜索模态框与 MCP `search` 在中文场景下体验差，是 Sprint 2 的核心 gap。

## What Changes

- 升级 FTS5 分词策略，支持中文 trigram 索引
- 索引时对 CJK 文本应用 bigram 预处理（或 trigram tokenizer 迁移）
- 查询时对中文 query 做匹配预处理
- reindex 迁移：重建 FTS 索引
- 更新搜索 spec 与测试

## Scope

### In Scope

- `internal/store/sqlite/schema.sql` FTS5 tokenizer 变更
- 索引/查询预处理逻辑
- reindex 时 FTS 重建
- CJK 搜索测试覆盖

### Out of Scope

- 向量/语义搜索（P3）
- jieba 外部分词器集成
- 韩文/日文专用优化（Han 统一处理即可）

## Capabilities

### Modified Capabilities

- `search-engine`: 中文 FTS 搜索质量

## Dependencies

- 建议在 `fix-workspace-scaffold-zh` 之后；与 `fix-ingest-job-cache` 可并行
