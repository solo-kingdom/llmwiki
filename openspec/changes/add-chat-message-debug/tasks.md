## Tasks

### Task 1: 数据库迁移 — `session_message_events` 表
- [ ] 在 `internal/store/sqlite/` 新增迁移，创建 `session_message_events` 表
- [ ] 表结构：`id` (PK), `message_id` (FK → ingest_session_messages.id ON DELETE CASCADE), `step`, `phase`, `message`, `payload`, `created_at`
- [ ] 创建索引 `idx_session_msg_events ON session_message_events(message_id, id DESC)`
- [ ] 测试：迁移成功，表和索引存在

**Files:** `internal/store/sqlite/migrate.go` (或在合适的 migrate 文件中添加)

### Task 2: Store 层 CRUD — `session_msg_events.go`
- [ ] 新增 `SessionMessageEvent` 结构体
- [ ] 实现 `InsertSessionMessageEvent` — 插入 + 自动 trim
- [ ] 实现 `ListSessionMessageEvents` — 按 message_id 查询，id ASC 排序
- [ ] 实现 `TrimSessionMessageEvents` — 保留最新 N 条
- [ ] 新增配置常量：`DefaultSessionMsgEventsMaxCount = 100`, Min=10, Max=500
- [ ] 实现 `GetSessionMessageEventsMaxCount` — 从 app_config 读取
- [ ] 实现 `ParseSessionMessageEventsMaxCount` — 验证配置值
- [ ] 测试：CRUD、trim、配置解析

**Files:** `internal/store/sqlite/session_msg_events.go`, `internal/store/sqlite/session_msg_events_test.go`

### Task 3: SessionMessageRecorder — 事件记录器
- [ ] 新增 `SessionMessageRecorder` 结构体（字段：db, messageID, maxN）
- [ ] 实现 `NewSessionMessageRecorder(db, messageID)`
- [ ] 实现 `Record(step, phase, message string, payload map[string]any)` — nil-safe
- [ ] 复用 `SanitizePayload()` 做脱敏
- [ ] 测试：记录事件、nil safety、payload 脱敏

**Files:** `internal/ingest/session_msg_recorder.go`, `internal/ingest/session_msg_recorder_test.go`

### Task 4: 提升 maxWorkspaceRuleFileLen
- [ ] 将 `maxWorkspaceRuleFileLen` 从 1500 改为 5000
- [ ] 验证 `ComposeSystemPrompt` 对 purpose.md 和 rules.md 的读取
- [ ] 无需迁移，下次 chat 自动生效

**Files:** `internal/ingest/prompts.go`

### Task 5: 后端埋点 — streamAssistantReply
- [ ] 在 `streamAssistantReply` 中创建 `SessionMessageRecorder`
- [ ] Event 1: `system_prompt` — 记录组装后的完整 system prompt + 总字符数
- [ ] Event 2: `messages_snapshot` — 记录消息数量、wiki refs 数、related subset 状态
- [ ] 将 recorder 传入 `RunSessionChatToolLoop` 调用
- [ ] 测试：发送 chat message 后数据库中有对应 events

**Files:** `internal/api/ingest_session.go`

### Task 6: 后端埋点 — RunSessionChatToolLoop
- [ ] 函数签名新增 `recorder *SessionMessageRecorder` 参数
- [ ] 每轮开始：记录 `llm_request` event（messages, tools_count, temperature, max_tokens, tool_choice）
- [ ] LLM 响应后：记录 `llm_response` event（content_preview, tool_calls）
- [ ] 工具执行后：记录 `tool_result` event（tool_name, arguments, result_preview, duration_ms）
- [ ] 所有 recorder 调用 nil-safe
- [ ] 更新所有调用点（`ingest_session.go`, `tool_loop_test.go`）
- [ ] 测试：tool loop 执行后数据库中有对应轮次的 events

**Files:** `internal/ingest/chat_wiki_executor.go`, `internal/api/ingest_session.go`, `internal/ingest/tool_loop_test.go`

### Task 7: API Endpoint — GetSessionMessageEvents
- [ ] 实现 `GetSessionMessageEvents` handler
- [ ] 验证 message 属于指定 session（安全检查）
- [ ] 支持 `?limit=` 查询参数
- [ ] 路由注册：`GET /api/v1/ingest/sessions/{sessionId}/messages/{messageId}/events`
- [ ] 测试：API 返回正确 events，404 处理

**Files:** `internal/api/ingest_session.go`, `internal/server/server.go`

### Task 8: Settings API — 新增配置项
- [ ] `GetSettings` 返回 `session_message_events_max_count`
- [ ] `UpdateSettings` 的 `allowedKeys` 新增 `"session_message_events_max_count"`
- [ ] 验证逻辑：范围 10-500
- [ ] 更新 Settings 类型

**Files:** `internal/api/settings.go`, `web/src/types.ts`

### Task 9: Frontend — 类型和 API 方法
- [ ] `types.ts` 新增 `SessionMessageEvent`, `SessionMessageEventsResponse` 类型
- [ ] `api.ts` 新增 `getSessionMessageEvents(sessionId, messageId, limit?)` 函数
- [ ] 测试：类型和 API 调用正确

**Files:** `web/src/types.ts`, `web/src/lib/api.ts`

### Task 10: Frontend — MessageDebugDialog 组件
- [ ] 新建 `MessageDebugDialog.tsx`
- [ ] Props: `open`, `onOpenChange`, `sessionId`, `message`
- [ ] 左侧：事件列表（step / phase / created_at），点击选中
- [ ] 右侧：选中事件的 payload JSON 格式展示
- [ ] 使用 `@base-ui/react/dialog` + `lucide-react` (Bug/X/Loader2)
- [ ] 复用 `JobLogDialog` 的布局样式
- [ ] 默认选中最后一个 event

**Files:** `web/src/components/MessageDebugDialog.tsx`

### Task 11: Frontend — MessageBubble 添加 Debug 按钮
- [ ] `MessageBubble` 新增 `onDebug` 可选 prop
- [ ] 在 action bar 中（Copy 和 Exclude 之间）添加 Bug 图标按钮
- [ ] 仅 assistant 消息 + 非 streaming 状态时显示
- [ ] `IngestChat` 维护 `debugMessageId` state
- [ ] 渲染 `MessageDebugDialog` 弹窗
- [ ] 导入 `Bug` 图标 from lucide-react

**Files:** `web/src/components/IngestChat.tsx`

### Task 12: i18n 文案
- [ ] 新增中英文 key：`chat.debug_prompt`, `chat.debug_title`, `chat.no_debug_events`
- [ ] 其他弹窗文案参考 `JobLogDialog` 的现有 key

**Files:** `web/src/i18n/zh.ts`, `web/src/i18n/en.ts`

### Task 13: 集成测试
- [ ] 后端集成测试：发送 chat message → 验证 events 写入 → API 查询 → events 完整
- [ ] 前端手动测试：点击 Debug 按钮 → 弹窗展示 → 事件切换
- [ ] 验证 tool loop 多轮场景下 events 记录完整
- [ ] 验证 `maxWorkspaceRuleFileLen` 提升后 purpose.md 不再被截断
- [ ] 验证配置项 `session_message_events_max_count` 的读写和 trim 生效
