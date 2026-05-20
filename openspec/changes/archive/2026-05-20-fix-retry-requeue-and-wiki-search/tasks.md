## 1. Retry 原地 requeue（后端）

- [x] 1.1 将 `RetryIngestJob` 改为 `UPDATE` 同一行：`status=queued`，清空 `error`、`error_code`、`error_message`、`missing_dependency`、`remediation`、`result_summary`；不 `INSERT`、不写 `parent_job_id`
- [x] 1.2 `POST /api/v1/ingest/jobs/{id}/retry` 返回 200 + 同一 `job.id`（更新 `RetryIngestJob` handler）
- [x] 1.3 确认 processor `claimNextJob` 能再次处理已 requeue 的 job；`commit_failed` 等特殊 `error_code` 在 requeue 时一并清空
- [x] 1.4 更新 `internal/store/sqlite/ingest_jobs_test.go`：断言同一 id、status queued、错误字段为空
- [x] 1.5 更新 `internal/api/api_test.go`：不再断言 `parent_job_id` / 201 Created
- [x] 1.6 更新 `internal/ingest/processor_test.go`：移除或改写 lineage 链测试为 requeue 语义

## 2. Retry 前端适配

- [x] 2.1 `AppContext.retryIngest` / `api.retryIngestJob` 适配 200 响应与同一 job id
- [x] 2.2 更新 `web/src/ingest.test.tsx` 等 mock/断言
- [x] 2.3 手动验证：failed job Retry、cancelled job Restart 后列表仅一条且为 queued

## 3. 搜索索引链路

- [x] 3.1 抽取或复用 `engine.Reindexer` 的单文件 indexing 逻辑，供 ingest 成功路径调用（写 wiki 后 `StoreChunks`）
- [x] 3.2 在 `JobProcessor` 成功提交 wiki 文件后触发 indexing（失败记日志，不使 job failed）
- [x] 3.3 `serve.go` 为 watcher 实现并注册 `Indexer`（`SetIndexer`），处理 wiki 路径 create/update/delete
- [x] 3.4 `SearchChunk` / API JSON 增加 `document_id` 字段；更新 `search.go`、`public_wiki.go`
- [x] 3.5 补充 Go 测试：ingest 或 indexing 后 `SearchChunks` 能命中；搜索响应含 `document_id`

## 4. Wiki SearchModal（仅 reader）

- [x] 4.1 新增 `web/src/lib/utils.ts` 辅助函数（若缺失）：`highlightText`、`getSearchHistory`、`saveSearchHistory`、`clearSearchHistory`
- [x] 4.2 新增 `SearchModal.tsx`（参考 mdserve：输入、防抖、历史、结果列表、键盘导航、底部快捷键）
- [x] 4.3 `WikiReaderLayout` header 增加 Search 按钮；挂载 `SearchModal`；注册 ⌘/Ctrl+K（仅在 reader 路由生效）
- [x] 4.4 `WikiReaderContext` / `SearchModal` 使用 `document_id` 调用 `selectDocument`
- [x] 4.5 侧栏 `Sidebar` reader variant 移除内嵌 `SearchBar`
- [x] 4.6 更新 `web/src/types.ts` 中 `SearchChunk` 类型
- [x] 4.7 前端测试：打开 modal、mock 搜索、选择结果调用 `selectDocument(id)`

## 5. 验证

- [x] 5.1 `go test ./internal/store/sqlite/... ./internal/api/... ./internal/ingest/...`
- [x] 5.2 `cd web && npm test -- --run`（或项目既有 Vitest 命令）
- [x] 5.3 手动：ingest 一篇 wiki → Wiki reader ⌘K 搜索标题/正文 → 打开文档
- [x] 5.4 手动：failed job Retry → 列表单条 queued，无重复 job、无残留 error_message
