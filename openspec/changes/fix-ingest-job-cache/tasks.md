## 1. 缓存模块重构

- [ ] 1.1 新增 `internal/ingest/cache.go`：统一 key 生成、lookup、save
- [ ] 1.2 实现 `contentSHA256([]byte)` 与 `cacheKeyForNormalized(*NormalizedSource)`
- [ ] 1.3 扩展 `CacheEntry` 结构（可选 `ContentSHA256` 字段）并保持 JSON 向后兼容
- [ ] 1.4 旧格式 cache entry lookup fallback

## 2. Pipeline 集成

- [ ] 2.1 在 `IngestNormalized()` 开头加入缓存检查
- [ ] 2.2 缓存命中时跳过 analyze/generate，记录 recorder 事件
- [ ] 2.3 缓存命中时验证 `WrittenFiles` 存在性（缺失则 miss）
- [ ] 2.4 重构 `Ingest()` 使用统一 cache 模块
- [ ] 2.5 ingest 成功后 `saveCache` 使用新 key 格式

## 3. Job 层透传

- [ ] 3.1 确认 `processor.go` / job 执行路径均走 `IngestNormalized()`
- [ ] 3.2 会话归档、文本提交、文件上传三条路径各加 cache hit 测试

## 4. 测试与验收

- [ ] 4.1 单元测试：相同 content 第二次 IngestNormalized 不调用 LLM（mock client）
- [ ] 4.2 单元测试：content 变化触发 cache miss
- [ ] 4.3 单元测试：WrittenFiles 缺失触发 cache miss
- [ ] 4.4 单元测试：旧 cache.json 格式仍可 lookup
- [ ] 4.5 运行 `go test ./internal/ingest/...`
