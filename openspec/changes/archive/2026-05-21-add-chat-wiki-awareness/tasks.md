## 1. 数据层与参考追踪

- [x] 1.1 在 `internal/store/sqlite/schema.sql` 添加 `ingest_session_references` 表及 migration
- [x] 1.2 实现 `UpsertSessionReference`、`ListSessionReferences` store 方法
- [x] 1.3 为 reference CRUD 添加 `_test.go` 覆盖唯一约束与 source 枚举

## 2. ContextResolver（FTS + graph + lint）

- [x] 2.1 新增 `internal/ingest/chat_context.go`：seeds（wiki_refs + FTS）、graph BFS depth=2、lint dead_link 过滤、top-8 排名
- [x] 2.2 实现 `@` 引用页 1-hop 邻居降权纳入子集
- [x] 2.3 新增 `FormatRelatedSubsetSection` 注入 system prompt
- [x] 2.4 为 ContextResolver 添加单元测试（mock DB graph + FTS）

## 3. Builtin chat wiki 工具执行器

- [x] 3.1 抽取或复用 `internal/mcp/tools.go` handler，新增 `internal/ingest/chat_wiki_executor.go`（search/read/references 只读）
- [x] 3.2 实现 `Registry.ChatServers()` 与 `Router.ListToolsForChat` / `CallToolForChat`（过滤写工具）
- [x] 3.3 chat executor 合并 builtin + chat-scoped 外部 MCP 工具列表
- [x] 3.4 tool `read` 成功时 UpsertSessionReference（source=tool_read）

## 4. Session chat 后端 API

- [x] 4.1 扩展 `POST .../messages` 接受 `wiki_refs`（校验、最多 5 个、read 全文注入 user context）
- [x] 4.2 用户 @ 引用时 UpsertSessionReference（source=user_mention）
- [x] 4.3 新增 `GET /api/v1/ingest/sessions/{id}/references` handler 与路由
- [x] 4.4 重构 `streamAssistantReply`：ContextResolver → RunToolLoop（max_rounds=4）→ 最终 assistant 内容
- [x] 4.5 SSE 增加 `tool_start` / `tool_done` 事件
- [x] 4.6 更新 `AssembleIngestChatMessages` 接入子集 section
- [x] 4.7 更新 `internal/ingest/prompts.go` session_chat 中英文默认任务说明
- [x] 4.8 添加 `ingest_session` API 测试（wiki_refs 校验、references 列表、tool 事件）

## 5. 归档参考页列表

- [x] 5.1 扩展 `BuildSessionArchiveMarkdown`：frontmatter `referenced_wiki_pages` + 正文 `## Referenced Wiki Pages`
- [x] 5.2 `ArchiveIngestSession` 从 `ListSessionReferences` 填充归档元数据
- [x] 5.3 plan/analysis 路径解析 archive frontmatter，将 referenced pages 注入 analysis 上下文（prefer update/merge）
- [x] 5.4 更新 `session_store_test.go` 与 review plan 相关测试

## 6. 前端 Ingest Chat UI

- [x] 6.1 扩展 `web/src/types.ts` 与 `api.ts`：`wiki_refs`、references API、SSE tool 事件类型
- [x] 6.2 实现 `@` 自动补全组件（搜索 wiki 文档、chip 选择、最多 5 个）
- [x] 6.3 `IngestChat` 发送消息携带 `wiki_refs`；用户气泡展示引用列表
- [x] 6.4 `AppContext` 解析 SSE `tool_start`/`tool_done`，展示工具状态与查阅页面列表
- [x] 6.5 添加 `ingest-chat.test.tsx` 覆盖 @ 选择与 tool 状态展示

## 7. 集成验证

- [x] 7.1 端到端：@ 引用页 → 对话 → tool read → 归档 → archive frontmatter 含 referenced_wiki_pages
- [x] 7.2 运行 `go test ./internal/ingest/... ./internal/api/...` 与 `npm test` 相关套件
