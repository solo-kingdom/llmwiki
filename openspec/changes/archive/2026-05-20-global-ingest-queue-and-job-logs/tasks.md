## 1. Schema 与 Store

- [x] 1.1 `ingest_jobs` 增加 `runner_id`、`heartbeat_at` 列；迁移脚本更新 `schema.sql`
- [x] 1.2 新增 `ingest_job_events` 表与 `(job_id, id DESC)` 索引；`ON DELETE CASCADE`
- [x] 1.3 可选：部分唯一索引 `idx_ingest_one_running`（`WHERE status='running'`）
- [x] 1.4 新增 `internal/store/sqlite/ingest_job_events.go`：`InsertJobEvent`、`ListJobEvents`、`TrimJobEvents(jobID, maxN)`、`TrimAllJobEvents(maxN)`
- [x] 1.5 新增 `RecoverStaleRunningJobs()`：超时 running → queued，清空失败字段与租约字段
- [x] 1.6 store 单元测试：insert、per-job trim、recover 清空 error 字段、cascade

## 2. Job Events 包

- [x] 2.1 新增 `internal/ingest/job_events.go`：`JobRecorder` 接口、`sqliteJobRecorder`、`SanitizePayload`
- [x] 2.2 `ParseJobEventsMaxCount` / 默认 200 / 边界 50–2000（可放 `internal/ingest` 或 `internal/activity` 旁新文件）
- [x] 2.3 payload 截断：`content_preview` 最大 32KB
- [x] 2.4 单元测试：sanitize、trim 联动 config

## 3. 全局串行 Processor

- [x] 3.1 `claimNextJob` 改为 `BEGIN IMMEDIATE` 事务：先 `RecoverStaleRunningJobs`，再条件认领
- [x] 3.2 生成稳定 `runner_id`（hostname+pid 或 UUID 进程生命周期常量）
- [x] 3.3 `Start()` 启动时调用 recover；执行 job 时启动 heartbeat goroutine（30s），结束或失败后停止
- [x] 3.4 recover 时为每个 job 写 `stale_recovered` event
- [x] 3.5 processor 测试：双 claim 仅一 running；stale 回 queued 且 error 字段空；心跳刷新

## 4. Pipeline 埋点

- [x] 4.1 `Pipeline` 增加 `SetRecorder`；`analyze`/`generate` 写 request/response
- [x] 4.2 `IngestNormalized` 写 normalize complete；`ApplyWikiBlocks` 后写 apply_files
- [x] 4.3 `JobProcessor` 在 git commit、index 失败路径写事件
- [x] 4.4 pipeline 测试：mock recorder 断言 step/phase 顺序

## 5. API

- [x] 5.1 `GET /api/v1/ingest/jobs/{id}/events` handler + 路由注册
- [x] 5.2 `settingsResponse` / `UpdateSettings` 增加 `ingest_job_events_max_count`；保存后 `TrimAllJobEvents`
- [x] 5.3 API 测试：events 404/200、settings 校验越界、recover 后 GET job 无 error_message

## 6. 前端

- [x] 6.1 `types.ts` + `api.ts`：`IngestJobEvent`、`getIngestJobEvents`
- [x] 6.2 新建 `JobLogDialog.tsx`：时间线 + 详情面板 + running 轮询
- [x] 6.3 `JobCard.tsx` 增加「日志」按钮并接入 Dialog
- [x] 6.4 `SettingsPage.tsx` 增加 job events 保留条数输入（50–2000）
- [x] 6.5 前端测试：JobCard 日志按钮、Dialog 展示 mock events、stale_recovered 提示

## 7. 验收

- [ ] 7.1 手动：制造 running 僵尸 → 重启服务 → job 变 queued 且 Jobs 卡无红字 → processor 继续处理
- [ ] 7.2 手动：提交 ingest → 打开日志模态框 → 可见 analysis/generation request 与 response
- [ ] 7.3 手动：Settings 调小 N → 旧 job 事件被 trim
