## 1. 数据库与 Store 层

- [x] 1.1 在 `internal/store/sqlite/schema.sql` 新增 `activity_logs` 表及索引（`created_at DESC`、`category + created_at`）
- [x] 1.2 在 schema 注释中标注 OPERATIONAL 数据边界，reindex 不 touch
- [x] 1.3 新增 `internal/store/sqlite/activity_logs.go`：`CreateActivityLog`、`ListActivityLogs`（分页+筛选）、`DeleteAllActivityLogs`、`CountActivityLogs`、`TrimActivityLogs(maxCount)`（按 created_at 删最旧）
- [x] 1.4 定义 `ActivityLog` Go 结构体，与表字段对应
- [x] 1.5 编写 store 层单元测试：插入、列表筛选、清空、Trim 删最旧、reindex 后记录仍存在

## 2. 活动日志写入层 (internal/activity/)

- [x] 2.1 创建 `internal/activity/log.go`：定义 `Entry` 结构体与 `Record(db, entry)` 公开 API
- [x] 2.2 实现 buffered channel + 后台 goroutine 异步写入
- [x] 2.3 实现 channel 满时 drop + stdout warning
- [x] 2.4 实现 `SanitizeDetails()` 或写入前过滤，禁止 api_key 等敏感字段
- [x] 2.5 实现 watcher debounce 合并器：同 path 700ms 内 modify 合并为一条
- [x] 2.6 编写 activity 包单元测试：异步写入、debounce 合并、敏感信息过滤

## 3. 后端 API

- [x] 3.1 新增 `internal/api/activity_logs.go`：`ListActivityLogsHandler`（GET，支持 limit/offset/category/level）
- [x] 3.2 实现 `DeleteAllActivityLogsHandler`（DELETE，返回 deleted_count，清空后写 logs_cleared）
- [x] 3.3 在 `internal/server/server.go` 注册 `GET /api/v1/logs` 和 `DELETE /api/v1/logs`
- [x] 3.4 编写 API 集成测试：列表、筛选、清空、鉴权

## 3b. Settings 与自动清理

- [x] 3b.1 在 `settingsResponse` 与 `UpdateSettings` 中新增 `activity_logs_max_count`（默认 10000，校验 100–100000）
- [x] 3b.2 实现 `TrimActivityLogsIfNeeded(db, maxCount)`：超限时删最旧并返回 deleted_count
- [x] 3b.3 在 `UpdateSettings` 保存 `activity_logs_max_count` 后立即调用 trim
- [x] 3b.4 在 `server.Start` 启动 goroutine：每 5 分钟读 config 并 trim；deleted_count > 0 时写 `logs_trimmed` 日志
- [x] 3b.5 编写 trim 与 settings 变更触发 trim 的单元/集成测试

## 4. Ingest 与 Session instrument

- [x] 4.1 在 `JobProcessor` 状态变迁点（queued→running→succeeded/failed/cancelled/retry）调用 `activity.Record`
- [x] 4.2 在 ingest API（create job、retry、cancel）补充对应日志
- [x] 4.3 在 session archive 开始/成功/失败路径记录 `category=session` 日志
- [x] 4.4 在 `streamSessionReply` error/incomplete/client 失败路径记录 `stream_error` 日志

## 5. Document、VCS、Provider instrument

- [x] 5.1 在 document API（create/update/delete/bulk-delete）记录 `category=document` 日志
- [x] 5.2 在 MCP document tools 入口记录 `category=mcp` + document 动作日志
- [x] 5.3 在 vcs API（init/disable/rollback 创建与结果）记录 `category=vcs` 日志
- [x] 5.4 在 provider-instances API（CRUD）记录 `category=provider` 日志，不含 api_key

## 6. System、MCP、Watcher instrument

- [x] 6.1 在 reindex handler 记录 started/completed 汇总日志
- [x] 6.2 在 models.dev sync 失败与服务启动时记录 system 日志
- [x] 6.3 在 MCP tools 统一入口记录 `tool_called` 摘要（tool 名，敏感参数过滤）
- [x] 6.4 在 watcher change handler 记录 file_created/file_deleted；modify 走 debounce 合并
- [x] 6.5 在 indexer 失败路径记录 `index_failed` error 日志

## 7. 前端：路由与 API

- [x] 7.1 在 `web/src/types` 新增 `ActivityLog` 类型
- [x] 7.2 在 `lib/api.ts` 新增 `listActivityLogs`、`clearActivityLogs`
- [x] 7.3 扩展 `WorkbenchView` 与 `wiki-routes.ts`：新增 `logs` 视图和 `/logs` 路由
- [x] 7.4 更新 `app-nav.test.tsx` 等路由测试
- [x] 7.5 在 `Settings` 类型与 `SettingsPage` 新增「Logs」卡片：最大保留条数输入，保存走现有 saveSettings

## 8. 前端：Logs 页面

- [x] 8.1 创建 `LogsPage.tsx`：日志列表、级别着色、空状态
- [x] 8.2 实现 category 与 level 筛选控件
- [x] 8.3 实现 3 秒轮询刷新（携带当前筛选参数）
- [x] 8.4 实现「加载更多」分页
- [x] 8.5 实现「清空全部日志」按钮 + 确认对话框 + 调用 DELETE API
- [x] 8.6 可选：details JSON 展开面板
- [x] 8.7 在 `WorkbenchLayout.tsx` NAV_ITEMS 新增 Logs Tab，渲染 LogsPage

## 9. 联调与验证

- [x] 9.1 端到端：ingest job 流转在 Logs 页可见
- [x] 9.2 端到端：外部编辑 wiki 文件触发 watcher 日志（modify 合并）
- [x] 9.3 端到端：Settings provider CRUD、VCS init 在 Logs 可见
- [x] 9.4 端到端：清空全部后列表刷新，存在 logs_cleared 记录
- [x] 9.5 端到端：reindex 后历史日志仍存在
- [x] 9.6 端到端：日志数超过 Settings 上限后自动 trim，最旧记录被删且产生 logs_trimmed
- [x] 9.7 编写 `LogsPage` 或 api 前端测试（轮询 mock、清空确认）
