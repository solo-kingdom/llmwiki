## Tasks

### Task 1: 数据库迁移 — `session_message_events` 表
- [x] 在 `internal/store/sqlite/` 新增迁移，创建 `session_message_events` 表
- [x] 表结构：`id` (PK), `message_id` (FK → ingest_session_messages.id ON DELETE CASCADE), `step`, `phase`, `message`, `payload`, `created_at`
- [x] 创建索引 `idx_session_msg_events ON session_message_events(message_id, id DESC)`
- [x] 在 `db.go` 的 `Migrate()` 中注册新迁移
- [x] 测试：迁移成功，表和索引存在

**Files:** `internal/store/sqlite/migrate_session_msg_events.go`, `internal/store/sqlite/db.go`

### Task 2: Store 层 CRUD — `session_msg_events.go`
- [x] 新增 `SessionMessageEvent` 结构体
- [x] 实现 `InsertSessionMessageEvent` — 插入 + 自动 trim
- [x] 实现 `ListSessionMessageEvents` — 按 message_id 查询，id ASC 排序
- [x] 实现 `TrimSessionMessageEvents` — 保留最新 N 条
- [x] 新增配置常量：`DefaultSessionMsgEventsMaxCount = 100`, Min=10, Max=500
- [x] 实现 `GetSessionMsgEventsMaxCount` — 从 app_config 读取
- [x] 实现 `ParseSessionMsgEventsMaxCount` — 验证配置值
- [x] 测试：CRUD、trim、配置解析

**Files:** `internal/store/sqlite/session_msg_events.go`, `internal/store/sqlite/session_msg_events_test.go`

### Task 3: SessionMessageRecorder — 事件记录器
- [x] 新增 `SessionMessageRecorder` 结构体（字段：db, messageID, maxN）
- [x] 实现 `NewSessionMessageRecorder(db, messageID)`
- [x] 实现 `Record(step, phase, message string, payload map[string]any)` — nil-safe
- [x] 复用 `SanitizePayload()` 做脱敏
- [x] 测试：记录事件、nil safety、payload 脱敏

**Files:** `internal/ingest/session_msg_recorder.go`, `internal/ingest/session_msg_recorder_test.go`

### Task 4: 提升 maxWorkspaceRuleFileLen
- [x] 将 `maxWorkspaceRuleFileLen` 从 1500 改为 5000
- [x] 验证 `ComposeSystemPrompt` 对 purpose.md 和 rules.md 的读取
- [x] 无需迁移，下次 chat 自动生效

**Files:** `internal/ingest/prompts.go`

### Task 5: 后端埋点 — streamAssistantReply
- [x] 在 `streamAssistantReply` 中创建 `SessionMessageRecorder`
- [x] Event 1: `system_prompt` — 记录组装后的完整 system prompt + 总字符数
- [x] Event 2: `messages_snapshot` — 记录消息数量、wiki refs 数、related subset 状态
- [x] 将 recorder 传入 `RunSessionChatToolLoop` 调用
- [x] 新增 `truncateDebugString` helper

**Files:** `internal/api/ingest_session.go`, `internal/api/api.go`

### Task 6: 后端埋点 — RunSessionChatToolLoop
- [x] 函数签名新增 `recorder *SessionMessageRecorder` 参数
- [x] 每轮开始：记录 `llm_request` event（messages, tools_count, temperature, max_tokens, tool_choice）
- [x] LLM 响应后：记录 `llm_response` event（content_preview, tool_calls）
- [x] 工具执行后：记录 `tool_result` event（tool_name, arguments, result_preview, duration_ms）
- [x] 所有 recorder 调用 nil-safe
- [x] 更新所有调用点（`ingest_session.go`, `tool_loop_test.go`）
- [x] 新增 `messageSummaries` 和 `toolCallSummaries` 辅助函数

**Files:** `internal/ingest/chat_wiki_executor.go`, `internal/api/ingest_session.go`, `internal/ingest/tool_loop_test.go`

### Task 7: API Endpoint — GetSessionMessageEvents
- [x] 实现 `GetSessionMessageEvents` handler
- [x] 验证 message 属于指定 session（安全检查）
- [x] 支持 `?limit=` 查询参数
- [x] 路由注册：`GET /api/v1/ingest/sessions/{id}/messages/{messageId}/events`

**Files:** `internal/api/ingest_session.go`, `internal/server/server.go`

### Task 8: Settings API — 新增配置项
- [x] `GetSettings` 返回 `session_message_events_max_count`
- [x] `UpdateSettings` 的 `allowedKeys` 新增 `"session_message_events_max_count"`
- [x] 验证逻辑：范围 10-500
- [x] 更新 Settings 类型

**Files:** `internal/api/settings.go`, `web/src/types.ts`

### Task 9: Frontend — 类型和 API 方法
- [x] `types.ts` 新增 `SessionMessageEvent`, `SessionMessageEventsResponse` 类型
- [x] `api.ts` 新增 `getSessionMessageEvents(sessionId, messageId, limit?)` 函数

**Files:** `web/src/types.ts`, `web/src/lib/api.ts`

### Task 10: Frontend — MessageDebugDialog 组件
- [x] 新建 `MessageDebugDialog.tsx`
- [x] Props: `open`, `onOpenChange`, `sessionId`, `message`
- [x] 左侧：事件列表（step / phase / created_at），点击选中
- [x] 右侧：选中事件的 payload JSON 格式展示
- [x] 使用 `@base-ui/react/dialog` + `lucide-react` (X/Loader2)
- [x] 复用 `JobLogDialog` 的布局样式
- [x] 默认选中最后一个 event

**Files:** `web/src/components/MessageDebugDialog.tsx`

### Task 11: Frontend — MessageBubble 添加 Debug 按钮
- [x] `MessageBubble` 新增 `onDebug` 可选 prop
- [x] 在 action bar 中添加 Bug 图标按钮
- [x] 仅 assistant 消息 + 非 streaming 状态时显示
- [x] `IngestChat` 维护 `debugMessageId` state
- [x] 渲染 `MessageDebugDialog` 弹窗
- [x] 导入 `Bug` 图标 from lucide-react

**Files:** `web/src/components/IngestChat.tsx`

### Task 12: i18n 文案
- [x] 新增中英文 key：`chat.debug_prompt`, `chat.debug_title`, `chat.no_debug_events`

**Files:** `web/src/i18n/messages/zh.ts`, `web/src/i18n/messages/en.ts`

### Task 13: 集成测试
- [x] 后端单元测试通过：store CRUD, recorder, tool loop
- [x] 前端 TypeScript 类型检查通过
- [x] Go build 全量通过
- [x] 注意：`TestClaimNextIngestJobSerial` 为预存失败（来自 parallel-job-execution change）

**Files:** (covered by tests above)
