## Why

Ingest Chat 页（`IngestChat`）当前仅依赖用户消息、附件摘要与工作区规则文件（`purpose.md` / `rules.md`），无法感知已有 wiki 库内容。用户在归档前无法询问「库里是否已有相关页面」、无法引用已有页面全文进行讨论，归档时 plan 链路也缺少「参考页面列表」，容易重复建页或遗漏 merge/update。Job 阶段已具备 MCP tool-call 与 search/read 能力，但 session chat 仍为纯文本流式回复，与 wiki 库脱节。

## What Changes

- Session chat 后端接入**只读 wiki 工具循环**（进程内 builtin `search` / `read` / `references`，可选 `scope.chat` 外部 MCP），模型可自主检索并**读取页面全文**。
- 发送消息 API 支持 `wiki_refs`（用户 `@` 指定的 wiki 页面）；后端读取全文注入本轮上下文，并记录引用来源。
- 新增 **ContextResolver**：结合 FTS、知识图谱（`links_to` BFS）与 lint 过滤，为每轮对话生成「相关 wiki 子集」索引（非全文灌入），引导模型按需 `read`。
- 新增 **session 级参考页面追踪**（`user_mention` + `tool_read`），归档时在 archive markdown frontmatter 与正文中写入 `referenced_wiki_pages`。
- 更新 `session_chat` 系统提示：wiki 页面（用户 @ 与 tool read）为合法依据；禁止编造未读页面内容。
- Ingest Chat UI：`@` 自动补全 wiki 页面、引用 chip、工具调用/引用状态展示；SSE 增加 tool 事件。
- Session chat 流式路径支持 tool loop 与最终回复流式输出的混合事件。

## Capabilities

### New Capabilities

- `chat-wiki-context`: Session 级 wiki 参考追踪、ContextResolver（FTS + graph + lint 子集）、builtin chat 只读工具执行器、归档参考页列表生成。

### Modified Capabilities

- `ingest-session-api`: 消息 API 扩展 `wiki_refs`；chat 回复 tool loop；SSE tool 事件；session references 查询；归档输出参考页列表。
- `ingest-chat-ui`: `@` wiki 页面选择、引用展示、tool 状态 UI。
- `workspace-prompt-profile`: `session_chat` 步骤默认任务说明扩展 wiki 依据优先级与忠实性约束。
- `ingest-pipeline`: session archive 格式含 `referenced_wiki_pages`；plan/analysis 消费参考页列表。

## Impact

- **Backend**: `internal/api/ingest_session.go`, `internal/ingest/session_chat.go`, `internal/ingest/session_store.go`, `internal/ingest/chat_wiki*.go`（新）, `internal/mcp/registry.go`, `internal/mcp/router.go`, `internal/llm/tools.go`
- **Store**: `internal/store/sqlite/schema.sql` — 新表 `ingest_session_references`；可选 messages 元数据
- **Frontend**: `web/src/components/IngestChat.tsx`, `web/src/context/AppContext.tsx`, `web/src/lib/api.ts`, `web/src/types.ts`
- **Specs/tests**: ingest session API 测试、session chat 测试、IngestChat 组件测试
- **Non-breaking**: 现有消息 API 在不传 `wiki_refs` 时行为兼容；归档 frontmatter 为增量字段
