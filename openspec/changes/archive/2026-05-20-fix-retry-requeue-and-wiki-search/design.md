## Context

### Retry

当前 `RetryIngestJob` 复制原 job 字段并 `CreateIngestJob`，设置 `ParentJobID`。OpenSpec `ingest-api` 与 `2026-05-20-ingest-jobs-ux-polish` design 明确选择 lineage 方案。用户现要求改为 **原地 requeue**，且 **清空所有失败/结果字段**，Jobs 列表不出现重复行。

Processor 通过 `claimNextJob` 拉取 `queued` 任务；requeue 后同一 `id` 应能被再次 claim。需确认 `retries` 计数是否在 requeue 时递增（建议递增以便排查，但不写入 `parent_job_id`）。

### Wiki 搜索

- **UI**：`WikiReaderLayout` 侧栏 `aside` 使用 `overflow-hidden`，内嵌 `SearchBar` 的 `absolute` 下拉被裁切。
- **数据**：`StoreChunks` 仅在 `engine.Reindexer` / 测试中调用；ingest 写 wiki 后未 indexing；`serve.go` 创建 watcher 但未 `SetIndexer`；`POST /api/v1/reindex` 为 501。
- **选择文档**：`SearchBar.handleSelect` 仅用 `filename` 匹配 `documents`，路径不唯一时会失败。
- **参考**：`mdserve` 的 `SearchModal` + `UIContext` ⌘K + `/api/search`；llmwiki 已有 `/api/v1/search` 与 `/api/public/wiki/search`，响应为 chunk 级 `SearchChunk`。

## Goals / Non-Goals

**Goals:**

- Retry/Restart 复用同一 job id，status=`queued`，清空错误与结果字段
- Ingest 成功与文件监视变更后，wiki 文档进入 FTS 可搜
- Wiki reader：Header 搜索 + SearchModal + ⌘K，点击结果按 `document_id` 打开文档
- 更新测试与 spec delta，废除 retry 新建 job 的断言

**Non-Goals:**

- 管理工作台搜索、路由持久化、archive LLM client、ingest chat 视觉
- 删除 `parent_job_id` 列（保留列，仅不再由 retry 写入）
- mdserve 的 Tags/Theme/Footer 等 reader 功能

## Decisions

### D1: Retry 原地 requeue，清空错误字段

**决策**: `RetryIngestJob` 对 failed/cancelled job 执行 `UPDATE`：

- `status = 'queued'`
- 清空：`error`, `error_code`, `error_message`, `missing_dependency`, `remediation`, `result_summary`
- **不**设置 `parent_job_id`，**不** `INSERT` 新行
- 可选：`retries = retries + 1`（记录重试次数，不暴露上次错误文案）

**API**: `POST .../retry` 返回 **200** + `{ job: <same id> }`（不再 201 Created）。

**理由**: 用户明确要求列表只看到 `queued`，不保留失败原因；与 lineage 多行列表冲突。

**替代方案**:

- 新建 job + 隐藏 parent：仍膨胀 DB，否决。
- 清空 status 但保留 `error_message` 在只读列：用户要求清空，否决。

### D2: 索引在 ingest 成功与 watcher 两条路径补齐

**决策**:

1. Ingest pipeline 在 wiki 文件写入成功并登记 `documents` 后，调用现有 `engine`/`StoreAdapter` 路径对对应文档执行 chunk + `StoreChunks`（与 `Reindexer.indexFile` 逻辑复用，避免重复实现）。
2. `serve` 启动 watcher 时 `w.SetIndexer(fileIndexer)`，`fileIndexer` 包装 `Reindexer` 或轻量 `IndexFile(relPath)`，与 `lwiki reindex` 行为一致。
3. 文档变更删除时同步 `DeleteChunks`。

**理由**: FTS 无 chunk 则搜索恒为空，换 UI 无法修复。

**非目标**: 实现 `POST /api/v1/reindex`（可后续 change）；本 change 至少保证「正常 ingest + watch」可搜。

### D3: 搜索命中携带 `document_id`

**决策**: `sqlite.SearchChunk` 与 API JSON 增加 `document_id`（或 `id`）字段；`SearchModal` / `WikiReaderContext` 使用 `selectDocument(id)`。

**理由**: `filename` 在树中不唯一；path+filename 仍不如 id 稳定。

### D4: Wiki 仅使用 SearchModal（mdserve 对齐）

**决策**:

- 新建 `web/src/components/SearchModal.tsx`（可参考 mdserve：输入行、历史、结果列表、底部快捷键、⌘K）。
- `WikiReaderLayout` header 右侧增加 Search 图标按钮；`useEffect` 注册 `Ctrl/Cmd+K`。
- 侧栏移除内嵌 `SearchBar`（或 reader variant 不再渲染），避免 `overflow-hidden` 裁切。
- 搜索仍调用 `WikiReaderContext.search` → `searchDocuments` / `searchPublicWiki`。
- 可移植 `highlightText`、`getSearchHistory` / `saveSearchHistory` 到 `web/src/lib/utils.ts`（若尚未存在）。

**理由**: Modal 不受侧栏 overflow 影响；与 mdserve 心智一致。

### D5: `GetJobLineage` 与 `parent_job_id`

**决策**: 本 change 不删除 API/DB 字段；测试改为 requeue 断言；`GetJobLineage` 仅服务历史数据，新 retry 不产生子节点。

## Risks / Trade-offs

- **[丢失失败历史]** → 用户选择清空；若日后需要审计，可另加 `job_events` 表，不在本 change。
- **[并发 retry]** → 同一 job 在 `running` 时被 retry 应 400；requeue 与 processor claim 需依赖 DB 状态机。
- **[索引性能]** → ingest 后立即 indexing 增加 job 耗时；可异步 goroutine，失败记日志不 fail job。
- **[大 workspace 首次 watch]** → rescan 可能较慢；与现有 watcher 行为一致。

## Migration / Compatibility

- 前端 `retryIngestJob` 若依赖 201 + 新 id，改为接受 200 + 同一 id。
- 已有 `parent_job_id` 链数据保留，Jobs UI 不再展示 lineage 折叠（若曾计划）可忽略。
- 用户若从未 `lwiki reindex`，本 change 后新 ingest 文档可搜；旧文档需一次 reindex 或触发 watcher 更新（可在 release note 说明）。
