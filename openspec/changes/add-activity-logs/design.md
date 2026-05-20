## Context

LLMWiki 是单进程 Go 服务 + 嵌入式 React SPA，SQLite（`.llmwiki/index.db`）存储 ingest jobs、sessions、provider instances 等运营数据。文档索引数据可从文件系统 reindex 重建，但操作审计日志无文件真相来源。

现有可观测性：
- **Jobs Tab**：仅展示 `ingest_jobs` 当前状态，不含 settings/provider/watcher/MCP 等操作
- **Timeline Tab**：Git commit 历史（`/api/v1/vcs/log`），非运行时系统日志
- **stdout `log.Printf`**：服务端控制台，前端不可见，无结构化持久化
- **wiki/log.md**：人工 wiki 变更记录，与系统日志无关

用户已确认 v1 决策：
- 八类事件全覆盖（含 watcher 文件变更）
- Tab 名称 **Logs**
- 清空操作为 **清空全部**（非按时间点）
- 与 wiki/log.md 完全独立

## Goals / Non-Goals

**Goals:**
- 在管理工作台提供独立 Logs Tab，展示系统运行时的结构化操作记录
- 日志持久化于 SQLite，reindex 不删除
- 支持 3 秒轮询实时刷新（与 Jobs 页一致）
- 支持按 category、level 筛选与分页加载
- 支持清空全部日志（含确认对话框；清空本身记一条 system 日志）
- Settings 可配置最大保留条数，后台定期自动删除超出部分的最旧日志
- v1 instrument 覆盖：ingest、document、vcs、provider、session、system、mcp、watcher

**Non-Goals:**
- 不镜像全部 stdout 日志到 DB
- 不同步或写入 wiki/log.md
- 不按时间点部分清空（v1 手动清空仍为「清空全部」；自动 retention 仅按条数）
- SSE/WebSocket 实时推送（v1 用轮询）
- 日志导出（CSV/JSON）
- 多用户审计（单用户模式，无 actor 字段）

## Decisions

### Decision 1: `activity_logs` 表作为 OPERATIONAL 数据

**选择**: 新增独立表，schema 注释归类为 OPERATIONAL——不可从文件系统重建，reindex 流程不 touch 此表。

**字段设计**:
```sql
activity_logs (
  id, created_at,
  level,       -- debug | info | warn | error
  category,    -- ingest | document | vcs | provider | session | system | mcp | watcher
  action,      -- created | updated | deleted | started | succeeded | failed | ...
  message,     -- 人类可读摘要（中文）
  resource_type, resource_id,
  status,      -- success | failure | pending | ''
  details,     -- JSON 字符串
  source       -- api | mcp | processor | watcher | cli
)
```

**索引**: `created_at DESC`、`(category, created_at DESC)`

### Decision 2: 异步非阻塞写入

**选择**: `activity.Record(db, entry)` 通过 buffered channel + 后台 goroutine 写 DB，写失败只打 stdout warning，不影响主业务路径。

**理由**: ingest pipeline 和 watcher 高频路径不能因日志 IO 阻塞；丢失少量日志可接受，主流程不可被拖慢。

### Decision 3: Watcher debounce 合并

**选择**: 在 activity 包或 watcher 集成层，对同一 `relPath` 在 700ms 窗口内的多次 `modify` 合并为一条 `watcher/file_modified` 日志；`create`/`delete` 不合并。

**理由**: 对齐 watcher 现有 debounce（700ms），避免批量编辑产生日志风暴。reindex 等批量索引记 system 汇总 + 逐条 index_failed（仅 error）。

### Decision 4: 轮询刷新而非 SSE

**选择**: Logs 页 `setInterval(3000)` 调用 `GET /api/v1/logs?limit=N`，与 JobsPage 模式一致。

**替代方案**: SSE 推送——真正实时但需连接管理，v1 过度设计。

### Decision 5: 清空全部 API

**选择**: `DELETE /api/v1/logs` 删除所有记录，响应 `{ deleted_count: N }`；随后写入一条 `system/logs_cleared` 日志。

**UI**: 确认对话框——「将永久删除所有系统日志，此操作不可恢复。」

### Decision 6: 敏感信息过滤

**选择**: 禁止写入 API key、完整 Authorization header；provider 操作只记 instance name/id；details 中 path/error 可写但不含密钥。

### Decision 7: Logs 与 Timeline/Jobs 定位区分

| 视图 | 用途 |
|------|------|
| Jobs | ingest 任务当前状态与操作（retry/cancel） |
| Timeline | Git wiki 版本历史 |
| Logs | 全局运行时审计流（含非 job 操作与 watcher） |

### Decision 8: Settings 配置最大保留条数 + 定期清理

**选择**: 在 `app_config` 存储 `activity_logs_max_count`（整数，默认 `10000`），Settings 页面提供数字输入；服务进程启动后台 goroutine，每 **5 分钟**检查一次，若 `COUNT(*) > max` 则删除最旧记录直至 `COUNT(*) <= max`。

**清理 SQL 策略**:
```sql
-- 删除超出 max 的最旧 N 条（N = count - max）
DELETE FROM activity_logs WHERE id IN (
  SELECT id FROM activity_logs ORDER BY created_at ASC LIMIT ?
);
```

**设置变更时立即清理**: `PUT /api/v1/settings` 更新 `activity_logs_max_count` 后，同步触发一次 trim（不等待定时器）。

**清理留痕**: 每次自动 trim 写入 `category=system, action=logs_trimmed`，`details` 含 `deleted_count`、`max_count`、`remaining_count`；不在每次 trim 写日志若 `deleted_count=0`。

**校验范围**: 允许值 `100`–`100000`；非法值拒绝或 clamp 到边界。

**理由**:
- 与现有 Settings + `app_config` 模式一致（如 `auto_reindex`）
- 定期清理避免 watcher 高频场景撑爆 SQLite；用户可在 Settings 调小/调大
- 按条数比按时间更直观，且与「最多保留条数」表述一致
- 手动「清空全部」仍保留，用于一次性归零

## Event Taxonomy (v1)

| category | 触发点 | 典型 action |
|----------|--------|-------------|
| ingest | JobProcessor, ingest API | queued, running, succeeded, failed, cancelled, retried |
| document | document API, MCP tools | created, updated, deleted, bulk_deleted |
| vcs | vcs API, rollback | init, disable, rollback_started, rollback_succeeded, rollback_failed |
| provider | provider-instances API | instance_created, updated, deleted |
| session | session API, archive pipeline | archive_started, archive_succeeded, archive_failed, stream_error |
| system | reindex, models sync, server start | reindex_started, reindex_completed, models_sync_failed, server_started |
| mcp | MCP tool handler | tool_called |
| watcher | file watcher | file_created, file_modified, file_deleted, index_failed |

## Risks / Trade-offs

**[Risk] Watcher 日志量仍可能较大** → debounce 合并 + 仅 index_failed 记 error + 条数上限自动 trim + 手动清空全部

**[Risk] 异步写入丢失** → channel 满时 drop 并 stdout warn；v1 可接受

**[Risk] instrument 遗漏** → tasks 清单逐模块勾选；联调时对照 Logs 页验证

**[Risk] reindex 误删日志** → schema 注释 + reindex 测试断言 activity_logs 保留

**[Trade-off] 自动 trim 删除最旧日志** → 用户调高 max 不能恢复已删记录；Settings 说明保留策略

**[Trade-off] 清空全部不可恢复** → UI 强确认；清空事件本身留痕
