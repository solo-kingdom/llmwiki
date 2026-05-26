## Phase 1: 数据层 — Mode 字段

- [x] 1.1 `internal/store/sqlite/schema.sql`：`ingest_sessions` 表新增 `mode TEXT NOT NULL DEFAULT 'ingest' CHECK(mode IN ('ingest','qa','organize'))` 列
- [x] 1.2 `internal/store/sqlite/ingest_sessions.go`：`IngestSession` struct 新增 `Mode string`；`scanIngestSession` 新增 `&s.Mode`；所有 SELECT 列表新增 `COALESCE(mode,'ingest')`
- [x] 1.3 `internal/store/sqlite/ingest_sessions.go`：`CreateIngestSession` INSERT 新增 `mode` 列；接收 struct 的 `Mode` 字段
- [x] 1.4 `internal/store/sqlite/ingest_sessions.go`：新增 `UpdateIngestSessionMode(id, mode string) error` 方法
- [x] 1.5 `internal/store/sqlite/ingest_sessions.go`：新增 migration 函数（`ALTER TABLE ingest_sessions ADD COLUMN mode ...`），在 DB 初始化时执行
- [x] 1.6 编写/更新 `ingest_sessions_test.go`：验证 mode 默认值、创建时指定 mode、更新 mode

## Phase 2: API — Mode 参数

- [x] 2.1 `internal/api/ingest_session.go`：`CreateIngestSession` handler 从 request body 读取 `mode`（可选，默认 `ingest`），传入 `IngestSession.Mode`
- [x] 2.2 `internal/api/ingest_session.go`：新增或扩展 `PATCH /api/v1/ingest/sessions/{id}` handler，支持 `{ "mode": "organize" }` 和 `{ "title": "..." }` 更新
- [x] 2.3 `internal/api/ingest_session.go`：所有返回 `IngestSession` 的响应自动包含 `mode` 字段（JSON 序列化由 struct tag 保证）
- [x] 2.4 `internal/server/server.go`：注册 PATCH 路由（如尚未有通用 PATCH 端点）
- [x] 2.5 编写/更新 API 测试：创建带 mode 的 session、PATCH 切换 mode

## Phase 3: Prompt — 模式化系统提示词

- [x] 3.1 `internal/ingest/prompts.go`：新增 `StepSessionQA PromptStep = "session_qa"` 和 `StepSessionOrganize PromptStep = "session_organize"` 常量
- [x] 3.2 `internal/ingest/prompts.go`：`defaultTaskInstructionZH` 新增 `StepSessionQA` 分支 — "你是 wiki 知识库问答助手，基于已有文档回答用户问题。必须使用 search/read 工具查找依据，不确定的明确说明"
- [x] 3.3 `internal/ingest/prompts.go`：`defaultTaskInstructionZH` 新增 `StepSessionOrganize` 分支 — "你是 wiki 架构师，负责诊断和优化 wiki 的结构与内容。使用诊断工具分析问题，给出具体的重组建议"
- [x] 3.4 `internal/ingest/prompts.go`：`defaultTaskInstructionEN` 新增对应英文版本
- [x] 3.5 `internal/ingest/prompts.go`：`lockedFormatInstruction` 新增 `StepSessionQA` 和 `StepSessionOrganize` 的格式约束（和 StepSessionChat 相同：以对话消息回复，不输出 FILE 块）
- [x] 3.6 新增辅助函数 `PromptStepForMode(mode string) PromptStep`：`"ingest"→StepSessionChat`, `"qa"→StepSessionQA`, `"organize"→StepSessionOrganize`

## Phase 4: 工具注册 — 按模式返回工具集

- [x] 4.1 `internal/mcp/local_tools.go`：将 `searchTool` 和 `readTool` 提取为包级变量
- [x] 4.2 `internal/mcp/local_tools.go`：新增 `referencesTool` Tool 定义（描述 wiki 引用关系查询工具）
- [x] 4.3 `internal/mcp/local_tools.go`：新增 `BuiltinToolDefinitionsForMode(mode string) []Tool` 函数，按 mode 返回不同工具集（ingest=[search,read], qa=[search,read,references], organize=[search,read,references,audit,structure,gaps,similar]）
- [x] 4.4 `internal/mcp/local_tools.go`：新增 `ToolLoopConfigForMode(mode string) llm.ToolLoopConfig` 函数（ingest→{4,4}, qa→{3,4}, organize→{6,4}）

## Phase 5: 诊断工具实现

### 5.1 audit 工具

- [x] 5.1.1 `internal/mcp/diagnostic_tools.go`（新文件）：实现 `auditTool` Tool 定义 + `executeLocalAudit` 函数
- [x] 5.1.2 audit 实现：调用 `engine.LintWorkspace()` 获取 lint 报告
- [x] 5.1.3 audit 实现：新增统计查询 — 标签分布（各标签页面数）、内容长度分布（过短页面 <200 字）
- [x] 5.1.4 audit 实现：新增未引用源文件查询（source_kind='source' 但无 forward references 的文档）
- [x] 5.1.5 audit 实现：格式化为结构化 markdown 报告输出

### 5.2 structure 工具

- [x] 5.2.1 `internal/mcp/diagnostic_tools.go`：实现 `structureTool` Tool 定义 + `executeLocalStructure` 函数
- [x] 5.2.2 structure 实现：读取 wiki/ 目录构建文件树（os.ReadDir 递归）
- [x] 5.2.3 structure 实现：统计各子目录页面数、标签分布（从 db 查询 wiki 页面的 tags）
- [x] 5.2.4 structure 实现：标记空目录（有 dirToPageType 映射但无文件的目录）
- [x] 5.2.5 structure 实现：格式化为树形 markdown 输出

### 5.3 gaps 工具

- [x] 5.3.1 `internal/mcp/diagnostic_tools.go`：实现 `gapsTool` Tool 定义 + `executeLocalGaps` 函数
- [x] 5.3.2 gaps mode=dangling：扫描所有 wiki 页面的 `[[link]]`，收集目标不存在的链接 + 引用次数（复用 lint 的 dead_link 逻辑，但汇总为缺失页面视角）
- [x] 5.3.3 gaps mode=uncited：查询 source_kind='source' 的文档中无 backlinks 的（即无 wiki 页面引用此源文件）
- [x] 5.3.4 gaps 实现：格式化输出

### 5.4 similar 工具

- [x] 5.4.1 `internal/mcp/diagnostic_tools.go`：实现 `similarTool` Tool 定义 + `executeLocalSimilar` 函数
- [x] 5.4.2 similar scan=true：遍历所有 wiki 页面（limit 50），取前 500 字作为 query，`db.SearchChunks(query, 5, "wiki")` 查找相似 chunk
- [x] 5.4.3 similar 去重：A→B 和 B→A 只保留一个（按路径字典序取先者）
- [x] 5.4.4 similar path=xxx 模式：只查指定页面的相似页面
- [x] 5.4.5 similar 实现：格式化输出候选对列表（含 FTS score）

### 5.5 工具执行路由

- [x] 5.5.1 `internal/mcp/local_tools.go`：`ExecuteLocalReadonlyTool` switch 新增 `audit`、`structure`、`gaps`、`similar` case

## Phase 6: Chat Agent 集成

- [x] 6.1 `internal/ingest/chat_wiki_executor.go`：`ChatWikiExecutor` struct 新增 `mode string` 字段
- [x] 6.2 `internal/ingest/chat_wiki_executor.go`：`NewChatWikiExecutor` 接收 `mode` 参数
- [x] 6.3 `internal/ingest/chat_wiki_executor.go`：`ListTools` 使用 `mcp.BuiltinToolDefinitionsForMode(e.mode)` 替代 `mcp.BuiltinReadonlyToolDefinitions()`
- [x] 6.4 `internal/api/ingest_session.go`：`streamAssistantReply` 读取 `session.Mode`，传递给 `NewChatWikiExecutor(... session.Mode ...)` 和 `PromptStepForMode(session.Mode)`
- [x] 6.5 `internal/api/ingest_session.go`：`AssembleIngestChatMessages` 接收 `PromptStep` 参数，替代硬编码的 `StepSessionChat`
- [x] 6.6 `internal/api/ingest_session.go`：tool loop config 使用 `mcp.ToolLoopConfigForMode(session.Mode)` 替代硬编码值
- [x] 6.7 `internal/ingest/session_chat.go`：`AssembleIngestChatMessages` 签名新增 `step PromptStep` 参数

## Phase 7: Archive + Pipeline 适配

- [x] 7.1 `internal/ingest/session_store.go`：`BuildSessionArchiveMarkdown` 新增 `mode string` 参数，frontmatter 中写入 `session_mode: {mode}`
- [x] 7.2 `internal/api/ingest_session.go`：`ArchiveIngestSession` 调用 `BuildSessionArchiveMarkdown` 时传入 `session.Mode`
- [x] 7.3 `internal/ingest/session_store.go`：`ParseReferencedWikiPagesFromArchive` 扩展为同时解析 `session_mode` 字段，或新增 `ParseSessionModeFromArchive` 函数
- [x] 7.4 `internal/ingest/prompts.go`：新增 `StepPlanOrganize PromptStep = "plan_organize"` 和 `StepPlanQA PromptStep = "plan_qa"`
- [x] 7.5 `internal/ingest/prompts.go`：`defaultTaskInstructionZH` 新增 organize plan 和 qa plan 的提示词分支（organize 侧重 update/move/merge；qa 侧重提取值得沉淀的问答知识）
- [x] 7.6 `internal/ingest/pipeline.go`：plan 阶段读取 archive 的 `session_mode`，选择对应的 PromptStep
- [x] 7.7 `internal/ingest/session_store.go`：`FormatReferencedPagesForAnalysis` 根据 mode 调整提示（organize: "以下页面可能需要重组"；qa: "以下页面可能需要更新"）

## Phase 8: 前端

- [x] 8.1 `web/src/types.ts`：`IngestSession` 新增 `mode: string`；`SessionListItem` 新增 `mode?: string`
- [x] 8.2 `web/src/lib/api.ts`：`createIngestSession` 新增可选 `mode` 参数；新增 `updateSessionMode(id, mode)` 函数
- [x] 8.3 `web/src/context/AppContext.tsx`：state 新增 `sessionMode`；`createSession` 支持 mode 参数；新增 `switchSessionMode(mode)` 方法（调用 API + 更新本地状态）
- [x] 8.4 `web/src/components/SessionControls.tsx`：新增 mode 选择器 UI（下拉或按钮组），显示当前 mode，点击切换
- [x] 8.5 `web/src/components/IngestChat.tsx`：按 `sessionMode` 显示视觉提示（💡/🔧 图标）；mode 切换时显示短暂 toast 提示
- [x] 8.6 `web/src/components/SessionControls.tsx`：新建 session 弹窗支持选择初始 mode（可选，默认 ingest）
- [x] 8.7 `web/src/context/AppContext.tsx`：`ensureIngestSession` 恢复 session 时读取并同步 mode

## Phase 9: 集成验证

- [x] 9.1 后端测试：创建 ingest/qa/organize 模式的 session，验证 prompt step、工具集、loop config 正确
- [x] 9.2 后端测试：在对话中切换 mode，验证下一轮使用新配置
- [x] 9.3 后端测试：archive organize session，验证 frontmatter 包含 `session_mode: organize`
- [x] 9.4 前端测试：mode 选择器交互、API 调用、状态同步
- [ ] 9.5 端到端手动测试：organize 模式完整流程（诊断 → 对话 → 归档 → plan → generate）
- [ ] 9.6 端到端手动测试：QA 模式问答流程
- [x] 9.7 运行 `go test ./...` 和 `npm test`（web）确保全量测试通过
