## Overview

为 Chat Session 的每条 assistant 消息建立完整的 prompt 调试追踪。复用 Ingest Job 的事件记录模式（step/phase/message/payload），在 prompt 组装和 tool loop 执行过程中埋入记录点，提供 UI 弹窗供用户和开发者查看 LLM 实际收到的完整上下文。同时提升 workspace 规则文件的读取长度限制。

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Chat Message Debug 架构                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  streamAssistantReply()                                             │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  ① 组装 system prompt                                  │          │
│  │     → recorder.Record("compose", "system_prompt", ...) │          │
│  │                                                        │          │
│  │  ② 组装 messages 数组                                  │          │
│  │     → recorder.Record("compose", "messages_assembled") │          │
│  └──────────────────────┬────────────────────────────────┘          │
│                         │                                           │
│                         ▼                                           │
│  RunSessionChatToolLoop()                                           │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  ③ 每轮 LLM 调用前                                     │          │
│  │     → recorder.Record("round_N", "llm_request", ...)   │          │
│  │                                                        │          │
│  │  ④ 每轮 LLM 响应后                                     │          │
│  │     → recorder.Record("round_N", "llm_response", ...)  │          │
│  │                                                        │          │
│  │  ⑤ 每次工具执行后                                      │          │
│  │     → recorder.Record("round_N", "tool_result", ...)   │          │
│  └──────────────────────┬────────────────────────────────┘          │
│                         │                                           │
│                         ▼                                           │
│  ┌───────────────────────────────────────────────────────┐          │
│  │              session_message_events 表                  │          │
│  │  (message_id, step, phase, message, payload, created)  │          │
│  └──────────────────────┬────────────────────────────────┘          │
│                         │                                           │
│                         ▼                                           │
│  ┌───────────────────────────────────────────────────────┐          │
│  │  GET /api/v1/ingest/sessions/{sid}/messages/{mid}/     │          │
│  │       events                                           │          │
│  └──────────────────────┬────────────────────────────────┘          │
│                         │                                           │
│                         ▼                                           │
│  ┌───────────────────────────────────────────────────────┐          │
│  │         MessageDebugDialog (UI 弹窗)                    │          │
│  │  左侧: 事件列表  │  右侧: Payload JSON 详情            │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Detailed Design

### 1. 数据库：`session_message_events` 表

**Schema：**

```sql
CREATE TABLE IF NOT EXISTS session_message_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT    NOT NULL REFERENCES ingest_session_messages(id) ON DELETE CASCADE,
    step       TEXT    NOT NULL,
    phase      TEXT    NOT NULL,
    message    TEXT    NOT NULL DEFAULT '',
    payload    TEXT    NOT NULL DEFAULT '',
    created_at TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_msg_events
    ON session_message_events(message_id, id DESC);
```

**字段说明：**

| 字段 | 说明 | 示例 |
|------|------|------|
| `message_id` | 关联的 assistant 消息 ID | `"msg_abc123"` |
| `step` | 流程阶段 | `"compose"`, `"round_0"`, `"round_1"` |
| `phase` | 事件类型 | `"system_prompt"`, `"llm_request"`, `"llm_response"`, `"tool_result"` |
| `message` | 人类可读描述 | `"System prompt assembled"` |
| `payload` | JSON 详情 | `{...}` |

**Retention：** 每条 message 最多保留 N 个 events（默认 100，可配置 `session_message_events_max_count`），超出自动 trim 最旧的。

### 2. Store 层 CRUD

新增文件 `internal/store/sqlite/session_msg_events.go`：

```go
type SessionMessageEvent struct {
    ID        int64  `json:"id"`
    MessageID string `json:"message_id"`
    Step      string `json:"step"`
    Phase     string `json:"phase"`
    Message   string `json:"message"`
    Payload   string `json:"payload"`
    CreatedAt string `json:"created_at"`
}

func (d *DB) InsertSessionMessageEvent(messageID, step, phase, message string, payload map[string]any, maxPerMessage int) error
func (d *DB) ListSessionMessageEvents(messageID string, limit int) ([]SessionMessageEvent, error)
func (d *DB) TrimSessionMessageEvents(messageID string, maxCount int) error
func (d *DB) GetSessionMessageEventsMaxCount() int
func ParseSessionMessageEventsMaxCount(s string) (int, error)
```

逻辑完全参照 `ingest_job_events.go` 的模式，包括 payload JSON 序列化、trim 逻辑、配置解析。

### 3. SessionMessageRecorder

新增 `internal/ingest/session_msg_recorder.go`：

```go
// SessionMessageRecorder 记录 chat 消息的 prompt 构建过程。
type SessionMessageRecorder struct {
    db        *sqlite.DB
    messageID string
    maxN      int
}

func NewSessionMessageRecorder(db *sqlite.DB, messageID string) *SessionMessageRecorder

func (r *SessionMessageRecorder) Record(step, phase, message string, payload map[string]any)
```

接口与 `SQLiteJobRecorder` 一致（但不实现 `JobRecorder` 接口——步骤命名不同，避免混淆）。内部调用 `db.InsertSessionMessageEvent`。

脱敏复用现有 `SanitizePayload()` 函数。

### 4. 事件记录点

#### 4.1 streamAssistantReply 中的记录

```go
func (a *API) streamAssistantReply(...) {
    // ... 现有逻辑 ...
    
    recorder := ingest.NewSessionMessageRecorder(a.db, assistantMsg.ID)
    
    // === Event 1: System Prompt ===
    // msgs 组装完成后（AssembleIngestChatMessages 之后）
    systemPrompt := msgs[0].Content  // 第一条是 system
    recorder.Record("compose", "system_prompt", "System prompt assembled", map[string]any{
        "total_chars":     len(systemPrompt),
        "system_prompt":   truncatePreview(systemPrompt, maxPayloadPreviewBytes),
        "message_count":   len(msgs),
        "history_skipped": skippedCount,
        "model":           model,
        "instance_id":     instanceID,
    })
    
    // === Event 2: Messages Assembled ===
    // 概览：消息数量、截断状态
    recorder.Record("compose", "messages_snapshot", "Messages assembled for LLM", map[string]any{
        "total_messages":     len(msgs),
        "user_content_chars": len(llmUserContent),
        "wiki_refs_count":    len(wikiRefs),
        "related_subset":     subsetSection != "",
    })
    
    // 将 recorder 传入 RunSessionChatToolLoop
    finalText, err := ingest.RunSessionChatToolLoop(ctx, client, executor, msgs, tools,
        temp, tokens, cfg, toolHandler, session.Mode, recorder)
}
```

#### 4.2 RunSessionChatToolLoop 中的记录

修改函数签名，新增 `recorder *SessionMessageRecorder` 参数（nil-safe）：

```go
func RunSessionChatToolLoop(
    ctx context.Context,
    client *llm.Client,
    executor llm.ToolExecutor,
    messages []llm.Message,
    tools []llm.ToolDefinition,
    temperature float64,
    maxTokens int,
    cfg llm.ToolLoopConfig,
    onEvent ToolEventCallback,
    mode string,
    recorder *SessionMessageRecorder,  // 新增
) (string, error) {
```

在 tool loop 各环节记录：

```go
for round := 0; round < cfg.MaxRounds; round++ {
    stepName := fmt.Sprintf("round_%d", round)
    
    // === Event: LLM Request ===
    if recorder != nil {
        recorder.Record(stepName, "llm_request", stepName+" LLM request", map[string]any{
            "model":       client.ModelName(),  // 如果有的话
            "messages":    messagesToMaps(msgs),
            "tools_count": len(tools),
            "temperature": temperature,
            "max_tokens":  maxTokens,
            "tool_choice": toolChoice,
        })
    }
    
    result, err := client.Chat(ctx, msgs, tools, temperature, maxTokens, ...)
    
    // === Event: LLM Response ===
    if recorder != nil {
        recorder.Record(stepName, "llm_response", stepName+" LLM response", map[string]any{
            "content_preview":  truncatePreview(result.Content, 500),
            "content_chars":    len(result.Content),
            "tool_calls_count": len(result.ToolCalls),
            "tool_calls":       toolCallsToMaps(result.ToolCalls),
        })
    }
    
    // 工具执行
    for _, tc := range calls {
        start := time.Now()
        out, execErr := executor.Execute(ctx, tc.Name, tc.Arguments)
        duration := time.Since(start)
        
        // === Event: Tool Result ===
        if recorder != nil {
            payload := map[string]any{
                "tool_name":    tc.Name,
                "arguments":    truncatePreview(tc.Arguments, 2000),
                "result_chars": len(out),
                "duration_ms":  duration.Milliseconds(),
            }
            if execErr != nil {
                payload["error"] = execErr.Error()
            } else {
                payload["result_preview"] = truncatePreview(out, 2000)
            }
            recorder.Record(stepName, "tool_result", tc.Name+" executed", payload)
        }
        
        // ... 现有逻辑 ...
    }
}
```

### 5. API Endpoint

```go
// GET /api/v1/ingest/sessions/{sessionId}/messages/{messageId}/events
func (a *API) GetSessionMessageEvents(w http.ResponseWriter, r *http.Request) {
    sessionID := getID(r, "sessionId")  // 或用 chi.URLParam
    messageID := getID(r, "messageId")
    
    // 验证 message 属于 session
    msg, err := a.db.GetIngestSessionMessage(messageID)
    if err != nil { ... }
    if msg == nil || msg.SessionID != sessionID { ... }
    
    limit := getIntQuery(r, "limit", 200)
    events, err := a.db.ListSessionMessageEvents(messageID, limit)
    // ... 返回 JSON ...
}
```

路由注册（`internal/server/server.go`）：

```go
// 在 session messages 路由组下添加
r.Get("/{id}/messages/{messageId}/events", s.api.GetSessionMessageEvents)
```

### 6. Frontend

#### 6.1 类型定义（`types.ts`）

```typescript
export interface SessionMessageEvent {
  id: number
  message_id: string
  step: string
  phase: string
  message: string
  payload: string
  created_at: string
}

export interface SessionMessageEventsResponse {
  events: SessionMessageEvent[]
}
```

#### 6.2 API 方法（`api.ts`）

```typescript
export function getSessionMessageEvents(
  sessionId: string,
  messageId: string,
  limit = 200,
): Promise<SessionMessageEventsResponse> {
  return request<SessionMessageEventsResponse>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}` +
    `/messages/${encodeURIComponent(messageId)}/events?limit=${limit}`,
  )
}
```

#### 6.3 MessageDebugDialog 组件

新建 `web/src/components/MessageDebugDialog.tsx`。

结构完全参照 `JobLogDialog.tsx`：
- 接收 `open`, `onOpenChange`, `sessionId`, `message` props
- 加载时调用 `getSessionMessageEvents(sessionId, message.id)`
- 左侧列表显示 step/phase，右侧显示格式化后的 payload JSON
- 使用 `@base-ui/react/dialog` + `lucide-react` 图标

#### 6.4 MessageBubble 修改

在 `IngestChat.tsx` 的 `MessageBubble` 组件中：

```tsx
// 新增 props
onDebug?: (messageId: string) => void

// 在 action bar 中添加 Debug 按钮（仅 assistant 消息且非 streaming）
{!isUser && (
  <button
    type="button"
    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
    title={t("chat.debug_prompt")}
    aria-label={t("chat.debug_prompt")}
    onClick={() => onDebug?.(msg.id)}
  >
    <Bug className="size-3.5" />
  </button>
)}
```

`IngestChat` 组件维护 `debugMessageId` state：

```tsx
const [debugMessageId, setDebugMessageId] = useState<string | null>(null)
const debugMessage = debugMessageId ? sessionMessages.find(m => m.id === debugMessageId) : null

// 传递给 MessageBubble
onDebug={(id) => setDebugMessageId(id)}

// 弹窗
<MessageDebugDialog
  open={!!debugMessageId}
  onOpenChange={(open) => { if (!open) setDebugMessageId(null) }}
  sessionId={sessionId}
  message={debugMessage}
/>
```

### 7. 配置

#### 新增配置项

| 配置键 | 默认值 | 范围 | 说明 |
|--------|--------|------|------|
| `session_message_events_max_count` | `100` | 10-500 | 每条 message 最多保留的 events 数 |

#### Settings API 变更

- `GetSettings`：返回新字段
- `UpdateSettings`：`allowedKeys` 新增 `"session_message_events_max_count"`
- 验证逻辑：复用类似 `ParseJobEventsMaxCount` 的模式

### 8. 提升 maxWorkspaceRuleFileLen

```go
// internal/ingest/prompts.go
const (
    maxWorkspaceRuleFileLen = 5000  // 原 1500 → 5000
)
```

这是一个独立的常量修改，影响 `ComposeSystemPrompt` 对 purpose.md 和 rules.md 的读取。1500 字符对于中文约 500 字（UTF-8 多字节），5000 字符约 1600 字，对于大多数 purpose.md 足够。

不需要迁移——下次 chat 时自动生效。

### 9. i18n 文案

新增 key（中英双语）：

| Key | 中文 | English |
|-----|------|---------|
| `chat.debug_prompt` | 调试 Prompt | Debug Prompt |
| `chat.debug_title` | Prompt 调试 | Prompt Debug |
| `chat.no_debug_events` | 暂无调试数据 | No debug data available |

## Error Handling

| 场景 | 处理 |
|------|------|
| recorder 为 nil | 所有 `recorder.Record()` 调用都是 nil-safe，不影响主流程 |
| DB 写入失败 | 静默忽略，不影响 chat 功能 |
| API 查询不存在 message | 返回 404 |
| Payload 过大 | 复用 `truncatePreview(32KB)` 限制 |

## Performance Considerations

- 每次 chat message 产生约 5-15 个 events（1 compose + 1-3 轮 × 3 events）
- 每个 event payload 约 2-10KB（system prompt 较大，tool result 可能较大）
- 每条 message 约 50-150KB 存储开销
- 默认 100 events/message × 200 字节索引 ≈ 极小的 SQLite 负担
- `ON DELETE CASCADE`：删除 message 自动清理 events
- 查询使用 `(message_id, id DESC)` 索引，高效

## Migration Path

1. **Phase 1**：数据库新表 + 后端 recorder 埋点 + API + 前端 Debug 按钮 + 弹窗
2. **Phase 2**（可选）：在弹窗中高亮截断警告（如 purpose.md truncated: true 时红色标记）
