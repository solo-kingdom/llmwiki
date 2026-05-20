## Why

Jobs 页面的 Retry/Restart 当前会 `CreateIngestJob` 创建带 `parent_job_id` 的子任务，导致列表膨胀、同一来源多次出现，与用户「重试就是再跑这一条」的预期不符。产品决策改为：**同一 job 原地 requeue**，且 **清空错误字段**，列表里只看到干净的 `queued` 状态。

Wiki 阅读器的搜索体验也不可用：侧边栏内嵌 `SearchBar` 的下拉结果被 `overflow-hidden` 裁切；更根本的是，生产路径中 **`document_chunks` 往往未被写入**（ingest 成功后未 indexing、watcher 未接 indexer），FTS 查询恒为空，用户感觉「搜索失效」。参考项目 `mdserve` 使用 Header 搜索按钮 + 全屏 `SearchModal` + ⌘K，体验成熟；本次仅在 **Wiki reader** 对齐该模式，不改动管理工作台。

## What Changes

- **Retry requeue**：`POST /api/v1/ingest/jobs/{id}/retry` 将 failed/cancelled job 更新为 `queued`，清空 `error`、`error_code`、`error_message`、`remediation`、`result_summary` 等失败/结果字段；**不**创建新 job 行；HTTP 响应返回 **同一 job**（建议 200）。
- **OpenSpec 更新**：修改 `ingest-api` 中 retry 场景描述，从 lineage 新建改为原地 requeue。
- **搜索索引**：ingest pipeline 成功写入 wiki 后触发 chunk 索引；`serve` 启动时为 watcher 挂载 `FileIndexer`（或等价实现），使文件变更可更新 FTS。
- **搜索 API**：搜索结果增加 `document_id`（或等价稳定标识），前端按 id 打开文档，避免仅按 `filename` 匹配失败。
- **Wiki SearchModal**：在 `WikiReaderLayout` header 增加搜索按钮；实现 `SearchModal`（参考 mdserve：历史、高亮、键盘导航、⌘/Ctrl+K）；移除或降级侧边栏内嵌 `SearchBar`，避免双入口与裁切问题。

## Capabilities

### New Capabilities

- `wiki-search-modal`: Wiki 阅读器专用搜索弹层与全局快捷键，对齐 mdserve 交互，不作用于管理工作台。

### Modified Capabilities

- `ingest-api`: Retry/Restart 改为原地 requeue + 清空错误字段；响应契约更新。
- `ingest-pipeline`: 成功产出 wiki 文档后更新 FTS 索引（chunk + triggers）。
- `search-engine`: 明确 ingest/文件变更后的索引义务；搜索命中携带 `document_id`。
- `wiki-reader-ui`: Header 搜索入口、SearchModal、⌘K；不再依赖侧栏内嵌下拉搜索。

## Impact

- **后端**: `internal/store/sqlite/ingest_jobs.go`（`RetryIngestJob`）、`internal/api/ingest.go`、`internal/ingest/processor.go`（requeue 后 claim 逻辑）、`cmd/llmwiki/serve.go`（watcher indexer）、ingest 成功路径 indexing
- **前端**: `WikiReaderLayout.tsx`、`SearchModal.tsx`（新建）、`WikiReaderContext.tsx`、`SearchBar.tsx`（移除或仅测试保留）、`api.ts` / `types.ts`（搜索命中含 id）、`JobCard` / `AppContext`（retry 响应适配）
- **测试**: `ingest_jobs_test.go`、`api_test.go`、`processor_test.go`、前端 wiki-reader / search 测试
- **OpenSpec**: `openspec/specs/ingest-api/spec.md` 等在 apply 阶段合并 delta

## Non-Goals

- 管理工作台搜索、Workbench URL 持久化、session_archive LLM instance 对齐、Ingest Chat 边框/宽度
- 保留 retry lineage（`parent_job_id` 链）用于新 retry
- Requeue 时保留上一轮 `error_message`（用户要求清空）
