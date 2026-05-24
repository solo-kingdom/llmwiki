## Context

当前 Pipeline 的 `runLLMStep()` 仅在有外部 MCP 服务器时才启用 tool loop。本地工具（`search`/`read`）仅在 `ChatWikiExecutor`（session chat）中可用。Pipeline 的 `analyze()` 和 `generate()` 步骤完全无法访问已有 wiki 知识库。

当前 `mergeBodyLLM()` 将新旧正文整体交给 LLM 合并，无结构化 diff，70% 长度守卫是唯一质量保障。

## Goals / Non-Goals

**Goals:**

- Pipeline 的 analyze/generate 步骤能通过 search/read 工具自主查找和读取已有 wiki 页面
- LLM 在分析阶段能区分"已有页面需 update"和"新知识需 create"
- LLM 在生成阶段能读取已有页面全文，生成精确的增量更新
- Wiki 页面合并从全量 LLM merge 升级为段落级精确增量 merge
- 完全向后兼容：无外部 MCP 时仍可用，merge 降级路径保留

**Non-Goals:**

- 嵌入向量 / 语义搜索
- 新增写入类工具给 Pipeline
- 多源联合摄入
- CRDT 级冲突解决
- Web UI 变更

## Decisions

### Decision 1: PipelineToolExecutor 组合架构

新增 `PipelineToolExecutor` 实现 `llm.ToolExecutor` 接口，组合本地工具和外部 MCP 工具：

```
PipelineToolExecutor struct {
    workspace  string
    db         *sqlite.DB
    mcpExec    *pipelineMCPExecutor  // 外部 MCP（可选）
}

ListTools(ctx):
    tools = [searchTool, readTool]           // 本地工具始终可用
    if mcpExec != nil:
        tools += mcpExec.ListTools()         // 外部 MCP 工具追加
    return dedupe(tools)

Execute(ctx, name, argsJSON):
    // 本地工具优先
    if name == "search" || name == "read":
        return ExecuteLocalReadonlyTool(workspace, db, name, args)
    // 外部 MCP 兜底
    if mcpExec != nil:
        return mcpExec.Execute(ctx, name, argsJSON)
    return "unknown tool", nil
```

工具优先级：本地 > 外部 MCP。本地工具无网络延迟、无故障风险。

### Decision 2: Pipeline struct 新增 db 字段

```go
type Pipeline struct {
    workspace   string
    db          *sqlite.DB          // 新增：供本地工具使用
    llmClient   *llm.Client
    lockMgr     *PageLockManager
    recorder    JobRecorder
    mcpExecutor *pipelineMCPExecutor
    toolLoopCfg llm.ToolLoopConfig
    docLang     string
    rulesSupplement string
    forceOverwrite  bool
}
```

`NewPipeline(workspace, db)` 签名变更。`JobProcessor` 已持有 `db`，直接传入。

### Decision 3: runLLMStep 始终启用本地工具

改造后的 `runLLMStep()`：

```
runLLMStep(ctx, step, messages, temp, maxTok):
    // 1. 构建组合 executor
    exec := &PipelineToolExecutor{
        workspace: p.workspace,
        db:        p.db,
        mcpExec:   p.mcpExecutor,
    }
    tools, _ := exec.ListTools(ctx)

    // 2. 配置 tool loop 参数
    cfg := p.toolLoopCfg
    if cfg.MaxRounds == 0:
        cfg = defaultToolLoopConfigForStep(step)

    // 3. 执行 tool loop
    result, err := llm.RunToolLoop(ctx, p.llmClient, exec, messages, tools, temp, maxTok, cfg)
    if err == nil:
        return result, nil

    // 4. 降级：纯 stream（无工具）
    ch, err := p.llmClient.StreamChat(ctx, messages, temp, maxTok)
    // ... 现有 stream 逻辑
```

### Decision 4: 步骤差异化 ToolLoopConfig

不同步骤对工具调用的需求不同：

| 步骤 | MaxRounds | MaxToolCallsPerRound | 理由 |
|------|-----------|---------------------|------|
| analyze | 3 | 3 | 搜索 + 读取相关页面 |
| generate | 2 | 3 | 读取要更新的已有页面 |
| plan | 3 | 3 | 规划需要了解现状 |
| merge_body | 0 | 0 | 不需要工具 |
| rollback | 0 | 0 | 不需要工具 |

```go
func defaultToolLoopConfigForStep(step PromptStep) llm.ToolLoopConfig {
    switch step {
    case StepAnalysis, StepPlan, StepPlanOrganize, StepPlanQA:
        return llm.ToolLoopConfig{MaxRounds: 3, MaxToolCallsPerRound: 3}
    case StepGeneration:
        return llm.ToolLoopConfig{MaxRounds: 2, MaxToolCallsPerRound: 3}
    default:
        return llm.ToolLoopConfig{MaxRounds: 0, MaxToolCallsPerRound: 0}
    }
}
```

### Decision 5: Prompt 增强 — 引导工具使用

在 `defaultTaskInstructionZH/EN` 中为 `StepAnalysis` 和 `StepGeneration` 追加工具使用引导。

**StepAnalysis 追加：**
> 你可以使用 search 工具搜索已有 wiki 页面，使用 read 工具读取页面全文。分析时应明确区分：哪些知识已有页面覆盖（建议 update），哪些是新知识（建议 create）。优先建议 update 已有页面。

**StepGeneration 追加：**
> 你可以使用 read 工具读取已有 wiki 页面的当前内容。对于已有页面，生成的内容应保留原有信息并增量补充新内容。不要删除已有页面中的重要段落，除非源文档明确否定。

### Decision 6: 段落级 Diff-Merge 算法

用段落（section）级 diff 替代全量 body merge：

```
DiffMergeBody(ctx, mc, oldBody, newBody):

  // Step 1: 分段
  oldSections = SplitSections(oldBody)   // 按 ## 标题分段
  newSections = SplitSections(newBody)

  // Step 2: 匹配 + 分类
  diffs = DiffSections(oldSections, newSections)

  // Step 3: 逐段处理
  result = []
  for each diff in diffs:
    switch diff.Type:
      case "unchanged":
        result += diff.Old.Content
      case "new":
        result += diff.New.Heading + diff.New.Content
      case "modified":
        merged = mergeModifiedSection(ctx, mc, diff.Old, diff.New)
        result += diff.Old.Heading + merged
      case "deleted":
        result += diff.Old.Content  // 保留旧内容（安全策略）

  // Step 4: 长度守卫
  if len(result) < 0.7 * len(oldBody):
    return error "diff merge too aggressive"

  return joinSections(result)
```

**分段规则：** 按 `## ` 标题分割。无标题的前言作为一个独立 section。`### ` 及以下级别的标题不作为分段依据，作为 section 内部内容。

**匹配策略：**

1. 精确标题匹配（首选）：`oldSection.Heading == newSection.Heading`
2. 标题模糊匹配（次选）：编辑距离 ≤ 3 或 `strings.Contains`
3. 内容相似度（兜底）：对无标题段落，比较前 200 字符的 trigram Jaccard 相似度 > 0.4
4. 无匹配的 new section → `new`；无匹配的 old section → `deleted`

**降级条件：** 当满足以下任一条件时降级到全量 `mergeBodyLLM()`：
- oldBody 或 newBody < 200 字符
- 无法匹配任何 section（结构差异过大）
- > 80% 的段落都是 modified（等于重写）
- 页面无 `## ` 标题结构

### Decision 7: 向后兼容

- `NewPipeline(workspace string)` 保留（db=nil，无工具能力，行为不变）
- `NewPipelineWithDB(workspace string, db *sqlite.DB)` 新增
- `MergeWikiPage()` 接口不变，内部优先使用 DiffMerge，降级使用 mergeBodyLLM
- JobProcessor 使用 `NewPipelineWithDB` 传入已有的 db
- ToolLoopConfig.MaxRounds=0 等价于"不启用工具"（保持 merge_body/rollback 等步骤的现有行为）

## Risks

| 风险 | 缓解 |
|------|------|
| 工具调用增加 LLM token 成本（analyze 3 轮 + generate 2 轮） | 工具调用是 LLM 的可选行为；通过 JobRecorder 记录使用量便于监控；MaxRounds 有上限 |
| LLM 可能不调用工具（模型能力差异） | 工具调用是增强而非强制；不调用工具时行为与当前一致 |
| Diff-Merge 段落匹配不准 | 降级到全量 mergeBodyLLM；保留 70% 长度守卫 |
| Diff-Merge 增加代码复杂度 | SplitSections/DiffSections 是纯函数，易测试；降级路径确保安全 |
| Pipeline 签名变更影响调用方 | 仅 NewPipeline 签名变；所有调用方在 internal/，可控 |
