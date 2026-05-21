## Why

`ApplyWikiBlocks()` 直接 `os.WriteFile` 覆盖已有 wiki 页面，可能导致静默丢失人工编辑或前序摄入内容。Review gate 仅保护 session 归档路径，raw 摄入、job 重试、MCP write 仍无自动合并。这是 gap 分析 P0-2，接真实 workspace 前必须完成。

## What Changes

- 写入前读取已有文件，执行分层合并策略
- 确定性字段合并：sources/tags/related 数组联合
- 锁定字段保护：type/title/created 不覆盖
- 正文 LLM 辅助合并（变化时），合并后长度检查（≥70% 旧内容）
- 可选 `--force-overwrite` 跳过合并（CLI/API flag）

## Scope

### In Scope

- `internal/ingest/merge.go` 新增
- `ApplyWikiBlocks()` 改造
- merge prompt 集成到 pipeline（复用 doc_language）
- 单元测试 + pipeline 集成测试

### Out of Scope

- Review gate 流程变更
- 双向链接对称性强制
- MCP write 工具的 merge（首版聚焦 ingest FILE blocks；MCP 可后续复用 merge 函数）

## Capabilities

### New Capabilities

- `page-merge-protection`: 摄入写入时的页面合并保护

### Modified Capabilities

- `ingest-pipeline`: FILE block 应用前执行 merge

## Dependencies

- 建议在 `fix-ingest-job-cache` 之后（避免 cache hit 跳过 merge 验证）
- 接第一个真实 workspace 前必须完成
