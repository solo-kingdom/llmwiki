## Context

`Ingest()` 在 L72-76 调用 `checkCache(sourcePath)`，基于文件 SHA256 跳过 pipeline。`IngestNormalized()` 无缓存，是 Web Hub、文本提交、会话归档 job 的执行路径。

现有 `cache.json` 结构：`Entries map[absFilePath]*CacheEntry`，仅适用于磁盘文件路径。

## Goals / Non-Goals

**Goals:**

- 相同 normalized 内容重复提交时跳过 LLM 调用
- 文件摄入与 job 摄入共享缓存基础设施
- 缓存 miss（内容变化）时正常执行 pipeline 并更新缓存

**Non-Goals:**

- 基于 LLM 输出语义的去重
- 分布式/多实例缓存

## Decisions

### Decision 1: 缓存 Key 设计

```
CacheKey = canonicalPath + "|" + contentSHA256

canonicalPath 来源:
  - 文件摄入: NormalizedSource.CanonicalPath (如 raw/sources/foo.pdf)
  - 文本摄入: 稳定路径 (如 raw/sources/web-ingest-{id}.md)
  - 会话归档: session 对应的 canonical path
```

**向后兼容**: 旧 key（纯 abs 文件路径）在 lookup 时 fallback；写入时使用新 key 格式。

### Decision 2: 缓存命中行为

命中时：
1. 跳过 `analyze()` + `generate()`
2. recorder 记录 `cache_hit` 事件
3. 返回 `CacheEntry.WrittenFiles`（路径列表）
4. **不**重新 `ApplyWikiBlocks`（假设文件仍在磁盘；若文件被删，视为 cache miss 并 re-ingest）

可选验证：命中时检查 `WrittenFiles` 是否仍存在，缺失则降级为 miss。

### Decision 3: 内容 Hash 计算

对 `NormalizedSource.Content`（字节）计算 SHA256，与文件 path hash 解耦。

```go
func contentSHA256(content []byte) string
```

### Decision 4: 模块重构

提取 `cache.go`:
- `lookupCache(key string) (*CacheEntry, error)`
- `saveCache(key string, entry *CacheEntry)`
- `cacheKeyForNormalized(source *NormalizedSource) string`

`Ingest()` 和 `IngestNormalized()` 均调用统一入口。

## Risks

| 风险 | 缓解 |
|------|------|
| 缓存命中但 wiki 文件被手动删除 | 可选文件存在性检查；或 lint 发现后用户 re-ingest |
| canonicalPath 不稳定导致永远 miss | job_normalize 保证路径确定性 |
| 旧 cache.json 不兼容 | lookup fallback + 迁移写入新格式 |
