## Context

Ingest Chat（`IngestChat` + `POST /api/v1/ingest/sessions/{id}/messages`）当前通过 `AssembleIngestChatMessages` 组装 system prompt（`ComposeSystemPrompt(session_chat)`）并调用 `StreamChat`，仅感知 `purpose.md` / `rules.md` 与用户消息、附件摘要。Wiki 全文、FTS 搜索、引用图谱在 Job 阶段通过 MCP tool loop 可用，但 session chat 未接入。

用户要求：Chat 页能读 wiki **全文**；同时支持模型自主 search 与用户 `@` 指定；用 graph + lint 生成**相关子集**（非全文灌入）；归档时携带**参考页面列表**供 plan/analysis 使用。

## Goals / Non-Goals

**Goals:**

- Session chat 支持只读 wiki 工具（`search` / `read` / `references`），模型可自主检索并读取全文。
- 消息 API 支持 `wiki_refs`，用户 `@` 页面时注入全文并记录引用。
- ContextResolver 每轮生成 FTS + graph + lint 过滤后的相关页面索引（默认 top 8）。
- Session 级累积 `ingest_session_references`（来源 `user_mention` | `tool_read`）。
- 归档 markdown 写入 `referenced_wiki_pages` frontmatter 与正文节，plan/analysis 消费该列表。
- SSE 扩展 `tool_start` / `tool_done` 事件；UI 展示工具调用与 @ 引用。

**Non-Goals:**

- Chat 阶段写入 wiki（create/edit/append/delete 工具禁止）。
- 向 Chat 开放外部 MCP 写工具（即使 `allow_write_tools=true` 也忽略）。
- 自动将 graph 子集全文注入 prompt（子集仅为索引；全文仅 via `@` 或 `read`）。
- 将 graph 子集未 read 的页面写入归档参考列表（归档列表仅 `user_mention` + `tool_read`）。
- 替换 Wiki Reader 或合并 Chat/Wiki 为分屏布局。

## Decisions

### D1: Session 参考页独立表 `ingest_session_references`

**决策**: 新增表追踪 session 累积参考页，字段含 `session_id`, `document_id`, `relative_path`, `title`, `source`, `first_seen_at`；`(session_id, document_id)` 唯一。

**理由**: 归档需跨消息聚合；与 `ingest_session_messages` 解耦，避免扩展 message CHECK 约束。

**备选**: messages 加 JSON metadata — 查询归档列表需扫全表，弃用。

### D2: Builtin in-process chat tool executor

**决策**: 新增 `chatWikiExecutor`，直接调用 `internal/mcp/tools.go` 已注册的 handler（search/read/references），不依赖 HTTP `/mcp` 或用户 MCP 配置。

**理由**: Chat 应零配置可用；Job 的 `local_only` 降级语义（禁用全部工具）不适用于 Chat。

**备选**: 仅外部 MCP — 默认体验差，弃用。

### D3: 外部 MCP 作为可选增强（`scope.chat=true`）

**决策**: 扩展 `Registry.ChatServers()` 与 `Router.ListToolsForChat`；chat executor 合并 builtin + chat-scoped 外部工具，写工具一律过滤。

**理由**: 与现有 MCP 架构一致；复用 `2026-05-20-add-mcp-readonly-tool-policy` 设计预留。

### D4: Tool loop + 流式混合

**决策**: `streamAssistantReply` 改为：
1. 组装 messages（含 ContextResolver 子集 + @ 全文块）
2. `RunToolLoop` 非流式轮次；每轮 tool 执行发 SSE `tool_start`/`tool_done`
3. 最终文本用 `StreamChat` 或 loop 返回文本后以 token 事件回放（首版可非流式 final + 单次 flush，后续优化真流式）

**理由**: 现有 `RunToolLoop` 基于非流式 `Chat()`；完全重写 streaming tool loop 成本高。

**首版**: tool 阶段非流式，最终回复仍 `StreamChat`（tools 禁用）或 loop 完成后一次性 emit tokens。

### D5: ContextResolver 算法

**决策**:

```
seeds = wiki_refs + FTS(userQuery, limit=5, wiki only)
expand = BFS(document_references links_to, depth=2, maxNodes=20)
filter = 排除 lint dead_link 目标 path
rank = seed(1.0) > FTS(0.8) > 1-hop(0.7) > 2-hop(0.4)
take top 8 paths → system 追加「相关 wiki 子集」节（path + title only）
```

**@ 默认 1-hop 扩展**: 用户 @ 的页面作为 seed，将其 1-hop 邻居纳入子集排名（不自动 read）。

### D6: @ 引用注入格式

**决策**: 用户消息发送时，后端 read 全文（respect MCP read 120K budget per page），追加到 user content：

```
[Wiki 引用: wiki/concepts/attention.md]
<title 若可得>
<full markdown body>
---
<用户原文>
```

并 `UpsertSessionReference(..., source=user_mention)`。

### D7: 归档参考页列表（严格模式）

**决策**: `BuildSessionArchiveMarkdown` frontmatter 增加：

```yaml
referenced_wiki_pages:
  - path: wiki/...
    title: ...
    source: user_mention|tool_read
```

正文增加 `## Referenced Wiki Pages` 节。Plan/analysis user content 前缀说明这些页为已有 wiki 锚点，优先 update/merge。

### D8: Prompt 更新（session_chat）

**决策**: 修改 `defaultTaskInstructionZH/EN(StepSessionChat)` 与 `Session chat LLM assembly` spec：依据优先级为用户消息、附件、@ 全文、tool read 全文；禁止声称未读页面存在；graph 子集仅为候选索引。

### D9: API 扩展

**决策**:

- `POST .../messages` body: `{ content, wiki_refs?: [{ document_id, relative_path }] }`
- `GET .../sessions/{id}/references` 返回累积参考列表
- SSE events: `tool_start`, `tool_done`（payload: tool name, args summary, duration）

## Risks / Trade-offs

- **[Risk] Token 膨胀（多页 @ 全文）** → 单消息最多 5 个 wiki_refs；单页 read 沿用 120K 字符上限；超出返回 400 并提示缩减。
- **[Risk] Tool loop 延迟** → SSE tool 事件 + UI loading；max_rounds=4（低于 Job 的 6）。
- **[Risk] 模型幻觉「库里已有」** → prompt 约束 + 要求标注 path；子集仅索引不含正文。
- **[Risk] 归档参考页与 plan 不一致** → frontmatter 结构化字段；analysis prompt 显式列出 referenced_wiki_pages。
- **[Trade-off] 最终回复首版可能非真流式（tool 后轮次）** → 后续迭代 streaming tool loop。

## Migration Plan

1. 部署时 SQLite migration 添加 `ingest_session_references` 表（`internal/store` migrate）。
2. 后端与前端同步发布；旧客户端不传 `wiki_refs` 行为不变。
3. 已归档 session 无 references 表数据 — 仅新对话累积；可接受。
4. 回滚：移除 tool loop 分支，保留表（空表无害）。

## Open Questions

- 最终回复是否在 v1 实现真流式 tool loop，还是先 tool 非流式 + 最终 StreamChat？**建议 v1 后者。**
- `@` 上限 5 页是否足够？**建议 v1 为 5，可配置化留 P2。**
