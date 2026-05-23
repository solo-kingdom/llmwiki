## Why

当前 Pipeline 的 analyze/generate 步骤在处理已归档文档和重复摄入时存在三个核心缺陷：

1. **Pipeline 对已有 wiki 一无所知**：Chat 模式有 `ContextResolver` 做相关 wiki 子集解析，有 `ChatWikiExecutor` 提供 search/read 工具。但 Pipeline 的 `runLLMStep()` 仅在配置了外部 MCP 时才有工具能力，本地工具（search/read）完全不可用。结果：LLM 在分析/生成时是"盲"的，不知道 wiki 里已有什么，倾向于盲目 create 而非 update 已有页面。

2. **LLM 没有自主查找能力**：analyze prompt 不引导 LLM 使用工具搜索已有 wiki 内容，generate prompt 不引导 LLM 读取已有页面全文。归档对话的 `referenced_wiki_pages` 仅在 prompt 中列出路径索引，不注入实际内容，LLM 无法做精确的 create vs update 判断。

3. **Merge 策略粗糙**：当前 `mergeBodyLLM()` 把旧正文和新正文整体交给 LLM 合并，没有利用结构化 diff 信息。对 wiki 页面（按 `## 标题` 分段的结构化文档）而言，段落级精确合并能显著提升质量、降低丢信息风险、节省 token。

## What Changes

- **Pipeline 内置工具执行器**：新增 `PipelineToolExecutor`，将本地 search/read 工具始终注入 Pipeline 的 tool loop，不再依赖外部 MCP
- **LLM 自主查找引导**：增强 analyze/generate 的 prompt，引导 LLM 主动使用工具搜索和读取已有 wiki 页面，做出精确的 create vs update 判断
- **段落级精确增量 Merge**：改造 `MergeWikiPage()`，先用段落 diff 分析新旧内容差异，再对变更段落做精确 LLM merge，保留不变的段落不动

## Scope

### In Scope

- `internal/ingest/pipeline_tool_executor.go` 新增
- `internal/ingest/diff_merge.go` 新增
- `internal/ingest/pipeline.go` 改造（db 注入 + runLLMStep 始终带工具）
- `internal/ingest/merge.go` 改造（降级保留旧路径）
- `internal/ingest/prompts.go` 修改（工具使用引导）
- `internal/ingest/processor.go` 适配（传 db 给 Pipeline）
- 单元测试 + 集成测试

### Out of Scope

- Web UI 变更
- MCP Server 工具变更
- Review 流程变更
- 新增写入类工具（write/delete）
- 嵌入向量语义搜索

## Capabilities

### New Capabilities

- `pipeline-local-tools`: Pipeline 内置 search/read 工具执行器
- `pipeline-diff-merge`: 段落级精确增量合并

### Modified Capabilities

- `ingest-pipeline`: analyze/generate 步骤具备工具调用能力；merge 使用段落级 diff 策略

## Dependencies

- 依赖已有的 `page-merge-protection`（`merge.go` 基础设施）
- 依赖已有的 `mcp-server` 本地工具（`ExecuteLocalReadonlyTool`、`BuiltinReadonlyToolDefinitions`）
