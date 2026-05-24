## 1. Pipeline 内置工具执行器

- [x] 1.1 新增 `internal/ingest/pipeline_tool_executor.go`
  - `PipelineToolExecutor` struct（workspace, db, mcpExec）
  - `ListTools(ctx)`: 合并本地 search/read + 外部 MCP 工具，去重
  - `Execute(ctx, name, argsJSON)`: 本地工具优先（复用 `mcp.ExecuteLocalReadonlyTool`），外部 MCP 兜底

- [x] 1.2 修改 `internal/ingest/pipeline.go`
  - `Pipeline` struct 新增 `db *sqlite.DB` 字段
  - 新增 `NewPipelineWithDB(workspace string, db *sqlite.DB)` 构造函数
  - 保留 `NewPipeline(workspace string)` 不变（db=nil，无工具，向后兼容）
  - 新增 `SetDB(db *sqlite.DB)` 方法
  - 新增 `defaultToolLoopConfigForStep(step PromptStep) llm.ToolLoopConfig`：按步骤返回差异化 MaxRounds
  - 改造 `runLLMStep()`: 始终构建 `PipelineToolExecutor`，合并本地+外部工具，调用 `llm.RunToolLoop`；降级时保持 stream 路径

- [x] 1.3 修改 `internal/ingest/processor.go`
  - `NewJobProcessor()` 使用 `NewPipelineWithDB(workspace, db)` 传入 db
  - `preparePipelineForJob()` 中的 `attachMCPRouter()` 保留不变（外部 MCP 仍通过 mcpExecutor 注入）

## 2. Prompt 增强 — 引导工具使用

- [x] 2.1 修改 `internal/ingest/prompts.go`
  - `defaultTaskInstructionZH` 的 `StepAnalysis` 分支：追加工具使用引导段落（search/read 建议区分 create vs update）
  - `defaultTaskInstructionZH` 的 `StepGeneration` 分支：追加工具使用引导段落（read 已有页面，保留原有信息）
  - `defaultTaskInstructionEN` 同步修改对应分支

## 3. 段落级精确增量 Merge

- [x] 3.1 新增 `internal/ingest/diff_merge.go`
  - `Section` struct: Heading, Level, Content, LineStart
  - `SectionDiff` struct: Type (unchanged/modified/new/deleted), Old *Section, New *Section, Similarity float64
  - `SplitSections(body string) []Section`: 按 `## ` 标题分段，无标题的前言作为独立 section
  - `DiffSections(oldSections, newSections []Section) []SectionDiff`: 匹配 + 分类
    - 精确标题匹配
    - 模糊匹配（编辑距离 ≤ 3）
    - 无标题段落的内容相似度匹配（trigram Jaccard > 0.4）
  - `sectionSimilarity(a, b string) float64`: 文本相似度计算
  - `mergeModifiedSection(ctx, mc, oldSec, newSec) (string, error)`: 单段精确 LLM merge
    - prompt: "以下是 wiki 页面中「{heading}」章节的旧正文和新正文。请合并：保留旧内容所有重要信息，仅补充新内容中的增量。"
    - temperature=0.1
  - `shouldUseDiffMerge(oldBody, newBody string) bool`: 判断是否适合段落级 merge（降级条件判断）
  - `DiffMergeBody(ctx, mc, oldBody, newBody) (string, error)`: 入口函数
    - 判断降级条件 → 不满足则调 `mergeBodyLLM()`
    - 分段 → diff → 逐段处理 → 组装 → 长度守卫

- [x] 3.2 修改 `internal/ingest/merge.go`
  - `MergeWikiPage()` 改为调用 `DiffMergeBody()` 替代 `mergeBodyLLM()`
  - `mergeBodyLLM()` 保留作为降级路径（`DiffMergeBody` 内部在不适合段落级 merge 时调用）

## 4. 测试

- [x] 4.1 新增 `internal/ingest/pipeline_tool_executor_test.go`
  - TestPipelineToolExecutor_ListTools_LocalOnly
  - TestPipelineToolExecutor_ListTools_WithMCP
  - TestPipelineToolExecutor_Execute_LocalSearch
  - TestPipelineToolExecutor_Execute_LocalRead
  - TestPipelineToolExecutor_Execute_MCPFallback
  - TestPipelineToolExecutor_Execute_UnknownTool

- [x] 4.2 修改 `internal/ingest/pipeline_test.go`
  - TestRunLLMStep_WithLocalTools：验证 db 非空时工具可用
  - TestRunLLMStep_NoDB_NoTools：验证 db 为空时降级到 stream

- [x] 4.3 新增 `internal/ingest/diff_merge_test.go`
  - TestSplitSections_BasicHeadings
  - TestSplitSections_NoHeadings
  - TestSplitSections_MixedLevels
  - TestDiffSections_ExactMatch
  - TestDiffSections_NewSection
  - TestDiffSections_DeletedSection
  - TestDiffSections_ModifiedSection
  - TestSectionSimilarity_Identical
  - TestSectionSimilarity_Different
  - TestShouldUseDiffMerge_ShortContent
  - TestShouldUseDiffMerge_NoHeadings
  - TestShouldUseDiffMerge_NormalCase
  - TestDiffMergeBody_Integration (mock LLM)

- [x] 4.4 修改 `internal/ingest/merge_test.go`
  - TestMergeWikiPage_UsesDiffMerge：验证新路径被调用
  - TestMergeWikiPage_FallbackToFullMerge：验证降级路径

## 5. 集成验证

- [x] 5.1 端到端测试：有 db 的 Pipeline 执行 ingest job 时 tool loop 可用
- [x] 5.2 端到端测试：DiffMerge 在已有页面上做段落级合并
- [x] 5.3 验证无 db 时 Pipeline 行为与当前一致
- [x] 5.4 验证 JobRecorder 记录工具调用事件
