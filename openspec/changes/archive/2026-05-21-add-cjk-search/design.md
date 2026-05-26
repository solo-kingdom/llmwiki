## Context

`chunks_fts` 使用 `tokenize='porter unicode61'`。`chunks.go` 已有 `hasCJK()` 和 LIKE fallback，但：
- LIKE 无 BM25 排序
- 短 query 召回不稳定
- `cjk_test.go` 注释标明 "full CJK support pending"

nashsu 使用 TypeScript bigram 分词；SQLite FTS5 原生支持 `trigram` tokenizer（SQLite 3.34+，modernc 应支持）。

## Goals / Non-Goals

**Goals:**

- 中文 query「注意力机制」能召回含该词的 wiki chunk
- 英文搜索行为不退化
- reindex 后自动生效

**Non-Goals:**

- 混合搜索 RRF（P3）
- 自定义 jieba 词典

## Decisions

### Decision 1: FTS5 Trigram Tokenizer

迁移 `chunks_fts` 为：

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='trigram'
);
```

**理由**: trigram 对 CJK 字符序列天然有效，无需外部分词器；英文短词也可匹配。

**迁移**: schema migration 或 reindex 时 DROP + CREATE virtual table + 从 document_chunks 重建。

### Decision 2: Query 转义策略

trigram 模式下调整 `escapeFTSQuery()`:
- CJK query：直接 pass-through 或按字符 trigram 匹配（避免 porter 引号包裹破坏 trigram）
- 英文 multi-term：保留 AND 语义或使用 trigram 默认行为

### Decision 3: LIKE Fallback 保留

trigram FTS 为主；CJK query FTS 零结果时保留 LIKE 作为最后兜底（降低回归风险）。

### Decision 4: 迁移路径

1. 更新 schema.sql（新 DB）
2. 现有 DB：reindex 或 startup migration 检测 tokenizer 版本并重建 FTS
3. 文档说明：升级后需 `llmwiki reindex`

## Risks

| 风险 | 缓解 |
|------|------|
| trigram 索引体积增大 | 个人 wiki 规模可接受 |
| modernc sqlite trigram 不支持 | fallback bigram 预处理列 |
| 英文搜索行为变化 | 保留英文回归测试 |
