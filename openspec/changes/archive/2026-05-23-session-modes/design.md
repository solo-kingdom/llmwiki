## Context

当前 `IngestSession` 没有模式概念。所有 session 共享：
- `StepSessionChat` 系统提示词（`prompts.go`）
- `BuiltinReadonlyToolDefinitions()` 返回的 `[search, read]` 工具集（`local_tools.go`）
- 固定的 tool loop 参数 `{MaxRounds: 4, MaxToolCallsPerRound: 4, temp: 0.7, tokens: 2048}`（`ingest_session.go:471`）

消息处理的关键路径在 `streamAssistantReply()`（`ingest_session.go:395-480`）：
1. `ComposeSystemPrompt(StepSessionChat, ctx)` → 系统提示词
2. `executor.ListTools(ctx)` → 工具定义
3. `RunSessionChatToolLoop(...)` → 执行循环

这三个点是 mode 的精确插入位置。

Archive 路径（`ArchiveIngestSession`，`ingest_session.go:824-990`）：
- 构建 `BuildSessionArchiveMarkdown()` → 写入归档 markdown
- 创建 `IngestReview` + 排队 plan job
- Pipeline plan 阶段读取归档内容，生成修改计划

现有诊断基础设施：
- `engine.LintWorkspace()` → 死链、孤立页、frontmatter 检查（`lint.go`）
- `db.GetBacklinks()` / `db.GetForwardReferences()` → 引用图查询（`references.go`）
- `db.SearchChunks()` → FTS 搜索（`chunks.go`）
- `db.ListDocuments()` → 文档列表
- `ExecuteLocalReadonlyTool` 已支持 `references` 工具但未暴露给 agent

## Goals / Non-Goals

**Goals**

- 在 session 上新增 mode 属性，支持 ingest / qa / organize 三种模式
- Mode 可通过 API 切换，切换影响下一轮消息的 prompt / tools / config
- 为 organize 模式新增 4 个只读诊断工具（audit / structure / gaps / similar）
- 为 qa 模式暴露 references 工具
- Archive markdown 携带 session_mode，pipeline plan 阶段按 mode 切换提示词
- 前端新增 mode 选择器，支持对话中切换

**Non-Goals**

- 不引入新的 pipeline 实现（复用现有 archive → review → plan → generate 流程）
- 不新增数据库表
- 不让 agent 直接执行写操作
- 不做 mode 切换时的动画或复杂过渡效果
- 不为 mode 切换引入额外计费或权限控制

## Decisions

### Decision 1: Mode 存储在 session 级别

**选择**：在 `ingest_sessions` 表新增 `mode TEXT DEFAULT 'ingest' CHECK(mode IN ('ingest','qa','organize'))`。

**替代方案**：
- Per-message mode：每条消息带 mode，更精确但复杂度高，且当前不需要在单条消息内混合模式
- Ephemeral mode（前端状态）：不持久化，但归档时管道无法知道对话的模式

**理由**：Session 级别 mode 是最简单的持久化方案。切换 mode 是一个轻量操作（PATCH），对现有代码改动最小。对话中切换时，历史消息的 mode 信息不关键——系统提示词在每轮都会重建。

### Decision 2: Mode 对三元组的映射

```
Mode      → PromptStep            → Tools                          → Loop Config
─────────────────────────────────────────────────────────────────────────────────
ingest    → StepSessionChat       → [search, read]                 → {Rounds:4, Per:4, temp:0.7, tok:2048}
qa        → StepSessionQA         → [search, read, references]     → {Rounds:3, Per:4, temp:0.5, tok:2048}
organize  → StepSessionOrganize   → [search, read, references,     → {Rounds:6, Per:4, temp:0.6, tok:3072}
                                    audit, structure, gaps, similar]
```

**理由**：
- QA 模式 temp 更低（0.5）因为需要精确回答而非创造性生成
- Organize 模式 Rounds 更多（6）因为诊断可能需要多轮工具调用；tokens 更多（3072）因为诊断报告通常较长
- QA 和 organize 都暴露 `references` 工具（已实现但未暴露），用于追踪引用链

### Decision 3: 工具注册按模式分组

**方案**：新增 `BuiltinToolDefinitionsForMode(mode string) []Tool` 函数，替代当前 `BuiltinReadonlyToolDefinitions()` 的直接调用。

```go
func BuiltinToolDefinitionsForMode(mode string) []Tool {
    base := []Tool{searchTool, readTool}
    switch mode {
    case "qa":
        return append(base, referencesTool)
    case "organize":
        return append(base, referencesTool, auditTool, structureTool, gapsTool, similarTool)
    default:
        return base
    }
}
```

`ChatWikiExecutor.ListTools()` 改为接收 mode 参数，使用 `BuiltinToolDefinitionsForMode(mode)`。

### Decision 4: 诊断工具的混合实现

每个工具分两层：

**第一层（Go 代码）**：机械检查，返回结构化原始数据
- `audit`：复用 `engine.LintWorkspace()` + 新增统计查询（标签分布、内容长度分布、未引用源文件数）
- `structure`：遍历 `wiki/` 目录构建文件树 + 统计各子目录页面数 + 标签分布
- `gaps`：查询 dangling links（引用但不存在）+ uncited sources（源文件无 wiki 引用）
- `similar`：对每个 wiki 页面取前 500 字做 FTS 查询，收集高分命中（排除自身），输出候选对

**第二层（LLM Agent）**：语义判断
- Agent 收到工具的结构化输出后，自行决定是否用 `read` 工具读具体页面
- Agent 做优先级排序、重组建议、内容判断
- 无需额外的 LLM 调用——Agent 本身就是 LLM

### Decision 5: similar 工具的 FTS 候选对算法

```go
func executeLocalSimilar(db *sqlite.DB, args map[string]interface{}) (string, error) {
    // scan=true 模式: 全局扫描
    // 对每个 wiki 页面:
    //   1. 取内容前 500 字作为 query
    //   2. SearchChunks(query, limit=5)
    //   3. 排除自身，记录高分 chunk (score > 0.5)
    //   4. 去重（A-B 对和 B-A 对只保留一个）
    // 输出候选对列表，让 Agent 决定是否进一步 read 分析
}
```

阈值暂定 0.5，后续可调。不做语义 embedding——FTS 已足够做初筛。

### Decision 6: Archive Markdown 携带 mode

在 `BuildSessionArchiveMarkdown()` 的 frontmatter 中新增 `session_mode` 字段：

```yaml
---
session_id: xxx
title: xxx
archived_at: 2026-05-23T...
source: web-ingest-session
session_mode: organize
referenced_wiki_pages: [...]
---
```

Pipeline 的 plan 阶段解析此字段，按 mode 选择提示词：
- `ingest` → 现有 plan 提示词（不变）
- `qa` → 侧重从对话中提取值得沉淀的问答知识
- `organize` → 侧重 wiki 重组（update/move/merge 而非 create）

### Decision 7: API 设计

**新增端点**：
- `PATCH /api/v1/ingest/sessions/{id}` 扩展支持 `{ "mode": "organize" }`

**修改端点**：
- `POST /api/v1/ingest/sessions` 支持 `{ "mode": "qa" }`（可选，默认 `ingest`）
- `POST /api/v1/ingest/sessions/{id}/messages?stream=1` 读取 `session.Mode` 驱动行为
- `POST /api/v1/ingest/sessions/{id}/archive` archive markdown 带 mode

**响应变更**：
- 所有返回 `IngestSession` 的端点新增 `mode` 字段

### Decision 8: 前端 Mode 切换 UX

**位置**：`SessionControls` 组件中，在 session 标题旁添加 mode 下拉/按钮组。

**切换行为**：
1. 用户点击 mode 选择器 → 选择新 mode
2. 前端调用 `PATCH /api/v1/ingest/sessions/{id} { mode: "organize" }`
3. 成功后更新本地状态
4. 输入框上方短暂提示"已切换到 XX 模式"
5. 下一条消息使用新 mode 的 prompt 和工具

**视觉区分**：
- 摄入：默认样式
- 问答：输入框旁小图标 💡
- 整理：输入框旁小图标 🔧

**新建 session**：可在创建时选择 mode（可选，默认 ingest）。

## End-to-End Flow

### 典型 organize 模式流程

```
用户创建/切换到 organize 模式
  │
  ▼
用户: "帮我检查一下 wiki 有什么问题"
  │
  ▼ streamAssistantReply()
  ├─ PromptStep = StepSessionOrganize
  ├─ Tools = [search, read, references, audit, structure, gaps, similar]
  ├─ Loop Config = {Rounds:6, Per:4, temp:0.6, tok:3072}
  │
  ▼ Agent 自主决定调用 audit 工具
  ├─ audit 返回: 3 错误, 7 警告, 孤立页列表, 死链列表, 缺失标签统计
  │
  ▼ Agent 分析结果
  ├─ 可能调用 read 读取具体问题页面
  ├─ 可能调用 similar 查找重复内容
  │
  ▼ Agent 回复
  "发现以下问题：... 建议将 A 移到 entities/, 为 B 补充标签, 合并 C 和 D"
  │
  ▼ 用户: "执行建议"
  │
  ▼ 用户点击"归档"
  ├─ Archive markdown 带 session_mode: organize
  ├─ Review 创建 + Plan job 排队
  │
  ▼ Pipeline Plan 阶段
  ├─ 看到 mode=organize → 使用 organize plan 提示词
  ├─ 生成的 plan 侧重 update/move/merge 操作
  │
  ▼ Review → Approve → Generate → 写入 wiki
```

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| similar 工具的全局扫描可能很慢（页面多时） | 限制单次扫描最多 50 个 wiki 页面；可加 `limit` 参数 |
| mode 切换后对话历史可能和新 prompt 不连贯 | 系统提示词在每轮重建，LLM 能适应；必要时可在 system prompt 中提及"你正在继续之前的对话" |
| organize 模式的 tool loop 轮次多（6），token 消耗高 | organize 模式有明确的诊断任务，6 轮是合理的上限；用户可通过 mode 切换回到低消耗模式 |
| pipeline plan 按 mode 切换提示词可能不够精确 | 初始版本用简单提示词差异，后续可根据实际效果迭代 |
| `references` 工具提升为一等公民可能暴露性能问题 | `references` 实现已存在于 `ExecuteLocalReadonlyTool`，只是未暴露；查询已有索引 |

## Migration Plan

1. **数据库 migration**：`ALTER TABLE ingest_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'ingest' CHECK(mode IN ('ingest','qa','organize'))`
2. **Go 代码**：按 Phase 顺序实现（见 tasks.md）
3. **前端**：mode 选择器 + 状态管理
4. **向后兼容**：mode 默认 `ingest`，所有现有 session 和 API 调用不受影响
