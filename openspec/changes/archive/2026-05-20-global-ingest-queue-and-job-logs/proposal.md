## Why

摄入任务队列目前仅在单进程内通过阻塞式 `processNext` 实现串行，数据库层允许多个 `status=running` 并存。服务异常退出后会产生僵尸 job，UI 长期显示 running 却无法结束。与 Git 版本控制（ingest 写 wiki + commit、rollback job）叠加时，并行执行会导致文件与提交顺序错乱。

排查 LLM 卡住或 pipeline 失败时，Jobs 页仅有 `error_message` 摘要，无法查看当前步骤、发给模型的内容与模型返回，只能翻服务端 stdout。

## What Changes

- **全局串行队列**：数据库层保证任意时刻最多一个有效 `running` job（租约 + 可选部分唯一索引）；`claimNextJob` 改为事务化认领
- **僵死 job 恢复**：启动时与认领前将心跳超时的 `running` job 自动恢复为 `queued`，并**清空** `error_code`、`error_message` 及相关失败字段；写入 `stale_recovered` 执行事件
- **运行心跳**：执行中定期刷新 `heartbeat_at`（及 `runner_id`）
- **Job 执行事件**：新增 `ingest_job_events` 表，记录 normalize / analysis / generation / apply_files / git_commit / index 等步骤及 LLM 请求/响应摘要
- **按 job 保留 N 条**：Settings 配置 `ingest_job_events_max_count`，每次插入后对该 job trim 最旧事件
- **Events API**：`GET /api/v1/ingest/jobs/{id}/events`
- **Jobs UI**：任务卡片「日志」按钮，模态框展示时间线与请求/响应详情；`running` 时轮询刷新

## Capabilities

### New Capabilities

- `ingest-job-events`: Job 执行事件存储、pipeline 埋点、按 job 条数 retention、查询 API

### Modified Capabilities

- `ingest-api`: 全局串行认领、僵死恢复语义、events 端点
- `ingest-pipeline`: 各步骤向 job events 写入 request/response
- `jobs-page-ui`: Job 日志模态框与轮询
- `web-ui`: Settings 增加每个 Job 执行日志保留条数

## Impact

- **Schema**: `ingest_jobs` 增加 `heartbeat_at`、`runner_id`；新增 `ingest_job_events` 表与索引；可选 `idx_ingest_one_running` 部分唯一索引
- **Go**: `internal/ingest/processor.go`（recover、claim、heartbeat）、`internal/ingest/pipeline.go`（recorder）、`internal/ingest/job_events.go`（新）、`internal/store/sqlite/`、`internal/api/ingest.go`、`internal/api/settings.go`
- **前端**: `JobCard.tsx`、`JobLogDialog.tsx`（新）、`JobsPage.tsx`、`SettingsPage.tsx`、`lib/api.ts`、`types.ts`
- **与 activity_logs 边界**: 全局审计仍走 `activity_logs`；单 job 调试明细走 `ingest_job_events`，不重复塞完整 LLM payload 到 activity

## User-Confirmed Decisions

- 僵死恢复目标状态：`queued`（非 `failed`）
- 僵死恢复时清空：`error_code`、`error_message` 及 retry 相关失败字段（与 manual retry 一致）
- 事件保留：按 job 最近 N 条，N 在 Settings 配置
- 部署假设：单 `llmwiki serve` 实例，不引入 workspace 文件锁
