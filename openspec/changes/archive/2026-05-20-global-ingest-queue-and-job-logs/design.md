## Context

LLMWiki 为单进程 Go 服务 + SQLite（`.llmwiki/index.db`）。`JobProcessor` 每 2s 轮询，`claimNextJob` 仅将 `queued` 更新为 `running`，不检查是否已有其他 `running`。进程崩溃后 DB 中 `running` 行永久残留，新进程只处理 `queued`，造成 Jobs 页多个「假运行中」任务。

Git 版本控制要求 ingest 与 rollback 共享串行队列（见 `git-version-control` design Decision 3），串行语义必须是**全局**（数据库），而非进程内巧合。

现有 `activity_logs` 记录 job 生命周期摘要，不适合存储完整 LLM 请求/响应。

## Goals / Non-Goals

**Goals:**

- 任意时刻最多一个**有效** `running` ingest job（含 rollback）
- 僵死 `running` 自动恢复为 `queued`，清空失败字段，可被 processor 再次认领
- 每个 job 可查询分步执行事件（含 LLM 入参/出参摘要）
- Settings 可配置每 job 事件保留上限，写入时自动 trim
- Jobs UI 模态框查看日志，`running` 时轮询

**Non-Goals:**

- workspace 级多实例文件锁（假定单 `llmwiki serve`）
- 运行中 job 的 cancel/中断（保持现有 deferred 语义）
- 将 job events 镜像到 `activity_logs` 或 wiki 文件
- SSE 推送 job events（v1 模态框内轮询即可）
- 事件导出、全文搜索

## Decisions

### Decision 1: 租约 + 事务认领实现全局串行

**选择**: `ingest_jobs` 增加 `runner_id TEXT`、`heartbeat_at TEXT`（ISO datetime）。认领与恢复在 `BEGIN IMMEDIATE` 事务内完成。

**认领逻辑**:

```sql
-- 伪代码（单事务）
RecoverStaleJobs();  -- 见 Decision 2
UPDATE ingest_jobs SET status='running', runner_id=?, heartbeat_at=datetime('now')
WHERE id = (SELECT id FROM ingest_jobs WHERE status='queued' ORDER BY datetime(created_at) ASC LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM ingest_jobs
    WHERE status='running'
      AND heartbeat_at > datetime('now', '-120 seconds')
  );
```

**心跳**: job 执行期间，独立 goroutine 每 30s `UPDATE heartbeat_at`（仅当 `id=? AND status='running' AND runner_id=?`）。

**双保险（可选）**: 部分唯一索引 `CREATE UNIQUE INDEX idx_ingest_one_running ON ingest_jobs(status) WHERE status='running'`。须与 Decision 2 同用，否则 kill -9 后索引会阻塞新认领。

**替代方案**: 仅进程内 mutex——无法防双进程，不采纳。

### Decision 2: 僵死恢复 → `queued` 并清空错误字段

**定义**: `status='running'` 且 `heartbeat_at < datetime('now', '-120 seconds')`（阈值写死 120s，不进 Settings）。

**触发时机**:

1. `JobProcessor.Start()` 启动时
2. 每次 `claimNextJob` 事务开头

**恢复动作**:

```sql
UPDATE ingest_jobs SET
  status = 'queued',
  error = '', error_code = '', error_message = '',
  missing_dependency = '', remediation = '', result_summary = '',
  runner_id = '', heartbeat_at = '',
  updated_at = datetime('now')
WHERE status = 'running' AND heartbeat_at < datetime('now', '-120 seconds');
```

**事件**: 对每个恢复的 job 写入 `ingest_job_events`：`step=system`, `phase=stale_recovered`, `message` 说明因心跳超时重新入队。

**不**写 `activity_logs` 的 error 级别（避免 Jobs 卡片仍显示红字）；可选 `activity.Record` info 级 `stale_recovered`。

**用户确认**: 僵死回 `queued` 时必须清空 `error_code` / `error_message`（及同 retry 的其它失败字段）。

### Decision 3: `ingest_job_events` 表

```sql
CREATE TABLE ingest_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,    -- system | normalize | analysis | generation | apply_files | git_commit | index
  phase TEXT NOT NULL,   -- start | request | response | complete | error | stale_recovered
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '',  -- JSON, 禁止 api_key
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_job_events_job_id ON ingest_job_events(job_id, id DESC);
```

**Payload 约定**（JSON）:

| step | phase | payload 字段示例 |
|------|-------|------------------|
| analysis | request | `model`, `messages`（role+content）, `temperature`, `max_tokens` |
| analysis | response | `content_preview`（截断至 32KB）, `duration_ms`, `char_count` |
| generation | request/response | 同上 |
| apply_files | complete | `paths_written`, `paths_deleted` |
| git_commit | complete/error | `sha`, `message` 或 `error` |
| normalize | complete | `canonical_path`, `input_type` |

写入前 `SanitizePayload` 剔除 `api_key`、`authorization` 等键。

### Decision 4: 按 job 保留 N 条

**Config key**: `ingest_job_events_max_count`（`app_config`）

- 默认：**200**
- 合法范围：**50–2000**（独立于 `activity_logs_max_count` 的 100–100000）
- 每次 `InsertJobEvent` 后：`DELETE` 该 `job_id` 超出 N 的最旧行（按 `id ASC`）

**Settings 变更**: 保存新 N 后，对所有 job 执行一次全局 trim（或 lazy：仅新写入时 per-job trim；v1 采用 per-insert trim 即可，改设置时可额外 `TrimAllJobEvents(maxN)`）。

### Decision 5: Pipeline 埋点接口

**选择**: `type JobRecorder interface { Record(step, phase, message string, payload map[string]any) }`

- `JobProcessor` 构造 `sqliteJobRecorder` 传入 `Pipeline`（通过 `SetRecorder` 或构造参数）
- `analyze` / `generate` 在 `StreamChat` 前后各写 request/response
- 流式响应在 channel 关闭后组装完整文本再写 response（与现逻辑一致）

**替代方案**: 仅 log.Printf——前端不可见，不采纳。

### Decision 6: API

- `GET /api/v1/ingest/jobs/{id}/events?limit=500` → `{ events: [...] }` 按 `id ASC` 时间线
- job 不存在 → 404
- Settings GET/PATCH 增加 `ingest_job_events_max_count`（与 `activity_logs_max_count` 并列）

### Decision 7: Jobs UI — `JobLogDialog`

- `JobCard` 增加「日志」按钮（`queued` 除外均可点；`running` 尤需）
- 模态框：左侧步骤列表（step + phase + 时间），右侧详情（格式化 JSON / Markdown 预览 `content_preview`）
- `running` 打开模态框时 `setInterval(2000)` 刷新 events，关闭清除
- 最后事件为 `stale_recovered` 时显示提示「服务重启或超时，任务已重新入队」

### Decision 8: 与 activity_logs 分工

| 数据 | 用途 |
|------|------|
| `activity_logs` | 全局审计：job 状态变迁、API 操作 |
| `ingest_job_events` | 单 job 调试：LLM 与 pipeline 明细 |

## Risks / Trade-offs

- **[僵死回 queued 重复执行]** 若 pipeline 已写 wiki 未 commit，重跑可能重复 LLM 调用 → 与现有 retry 一致；`commit_failed` 路径仍只重试 commit
- **[payload 体积]** 大文档 analysis 请求体大 → `content_preview` 截断 + per-job N 条上限
- **[120s 心跳误判]** 极慢 LLM 若超过 120s 无 token 仍刷新 HTTP 连接但无 heartbeat 更新… 心跳由 processor 独立 goroutine 刷新，与 LLM 是否出 token 无关，只要进程存活即续租
- **[部分唯一索引 + 未恢复]** 若忘记 RecoverStale，唯一索引会死锁队列 → 启动与 claim 必须调用 Recover

## Migration Plan

1. Schema migration：新列 + 新表 + 索引；现有 `running` 行在首次启动时由 Recover 清回 `queued`
2. 部署单实例服务；无需数据文件迁移
3. 回滚：移除 recorder 与 UI，保留 schema 列无害

## Open Questions

（均已由用户确认，无开放项）
