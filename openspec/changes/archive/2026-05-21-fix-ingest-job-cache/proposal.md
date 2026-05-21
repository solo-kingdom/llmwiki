## Why

Web UI 和 API 的 job-based 摄入（`IngestNormalized()`）是主要入口，但 SHA256 增量缓存仅在文件路径摄入（`Ingest()`）中生效。开发期反复提交相同内容、重试失败 job 时会重复消耗 LLM token，与 nashsu 参考实现和 gap 分析 P0-4 不一致。

## What Changes

- 在 `IngestNormalized()` 入口增加内容 SHA256 缓存检查
- 缓存 key 扩展为 `(canonicalPath, contentSHA256)`，支持 Web 文本/上传/会话归档等无固定文件路径的场景
- job 创建时记录 content hash；缓存命中时跳过 analysis + generation，直接返回已写入路径
- 统一 `Ingest()` 与 `IngestNormalized()` 的缓存读写逻辑

## Scope

### In Scope

- `internal/ingest/pipeline.go` 缓存逻辑重构
- `cache.json` schema 扩展（向后兼容旧条目）
- pipeline 与 processor 层测试

### Out of Scope

- 合并保护（独立 change）
- ingest 后 index 自动更新
- 跨 workspace 缓存共享

## Capabilities

### Modified Capabilities

- `ingest-pipeline`: job-based 摄入支持 SHA256 增量缓存

## Impact

- **Backend**: `internal/ingest/pipeline.go`, `internal/ingest/processor.go`
- **Frontend**: Jobs 页可展示 cache hit 状态（可选，非必须）
- **Data**: `.llmwiki/cache.json` 格式扩展

## Dependencies

- 建议在 `fix-workspace-scaffold-zh` 之后实施（独立可并行）
