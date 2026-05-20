## Why

当前系统操作记录分散在 stdout 控制台、`ingest_jobs` 任务状态和 Git Timeline 中，管理员无法在管理工作台统一查看 ingest、文档变更、版本控制、Provider 配置、MCP 调用、文件 watcher 等各类运行时事件。排查失败（如 session archive、索引错误、LLM stream error）时只能翻服务端日志，体验差且不可持久检索。

## What Changes

- **新增系统活动日志能力**：在 SQLite 中新增 `activity_logs` 表，持久化结构化操作记录（级别、类别、动作、消息、资源引用、详情 JSON）
- **新增统一写入层**：`internal/activity` 包提供异步 `Record()` API，供 API handler、JobProcessor、Watcher、MCP 等模块调用
- **v1 全覆盖 instrument**：ingest、document、vcs、provider、session、system、mcp、watcher 八类事件
- **Watcher 文件变更记录**：对 create/modify/delete 事件 debounce 合并后写入日志；索引失败单独记 error
- **新增 Logs API**：`GET /api/v1/logs`（分页与筛选）、`DELETE /api/v1/logs`（清空全部）
- **新增 Logs 全局 Tab**：管理工作台导航增加 Logs 入口，独立页面展示日志列表，3 秒轮询刷新，支持类别/级别筛选与清空全部
- **Settings 可配置日志保留上限**：在 Settings 页面设定 `activity_logs_max_count`（最大保留条数），存入 `app_config`
- **后台定期清理**：服务进程定期检查日志总数，超过上限时按时间删除最旧记录直至不超过配置值
- **与 wiki/log.md 无关**：系统日志为独立运营数据，不写入 wiki 文件，不参与 reindex 重建

## Capabilities

### New Capabilities
- `activity-logs`: 活动日志数据模型、SQLite 存储、异步写入、查询与清空 API、全链路 instrument 规则
- `logs-page-ui`: 管理工作台 Logs 页面——列表展示、筛选、轮询刷新、清空全部确认

### Modified Capabilities
- `web-ui`: 全局导航新增 Logs Tab；Settings 页面新增日志保留上限配置；OpenSpec 导航条目数更新

## Impact

- **新增 Go 包**: `internal/activity/`——日志写入与 debounce 合并
- **修改 Go 包**: `internal/store/sqlite/`——`activity_logs` 表与 CRUD；`internal/api/`——logs 端点；`internal/ingest/processor.go`、`internal/watcher/`、`internal/mcp/tools.go` 等 instrument 点
- **修改 schema**: `internal/store/sqlite/schema.sql` 新增 `activity_logs` 表及索引
- **新增前端**: `LogsPage.tsx`、路由 `/logs`、`WorkbenchView` 扩展
- **修改前端**: `WorkbenchLayout.tsx` 导航、`SettingsPage.tsx` 日志保留配置、`wiki-routes.ts` 路由、`lib/api.ts` 类型与调用
- **修改后端**: `internal/api/settings.go` 读写 `activity_logs_max_count`；`internal/server/server.go` 启动定期清理 goroutine
- **数据边界**: `activity_logs` 归类为 OPERATIONAL 数据，reindex 时保留，不可从文件系统重建
