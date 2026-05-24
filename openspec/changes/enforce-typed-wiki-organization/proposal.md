## Why

当前 Wiki 目录设计要求按知识类型组织页面，但实际生成与校验仍允许业务页面平铺在 `wiki/` 顶层，导致 `entities/`、`concepts/` 等目录空置、`index.md` 漏收页面、诊断工具难以发现结构问题。

同时，生成文本需要明确服从设置中的 `doc_language` 默认选项，避免模板、提示词或整理流程绕过用户选择的文档语言。

## What Changes

- 新增 typed wiki 组织契约：业务知识页必须落在已知类型目录，`wiki/` 顶层仅保留导航/系统页面。
- 生成阶段强化路径规则：LLM 输出 FILE 块时应优先选择 `wiki/entities/`、`wiki/concepts/`、`wiki/sources/`、`wiki/synthesis/`、`wiki/comparisons/`、`wiki/queries/`，不得将业务页写到 `wiki/*.md` 顶层。
- 写入阶段增加结构保护：对顶层业务页输出进行拒绝或明确错误，避免新内容继续平铺。
- lint/organize 诊断新增 misplaced page 检测，识别已存在的顶层业务页并给出移动建议。
- `wiki/index.md` 与结构工具排除 `wiki/templates/`，并对 misplaced pages 提供可见诊断，避免模板污染普通知识索引。
- 生成提示、模板指导、整理/归档规划应根据 `doc_language` 使用设置中的默认文档语言，中文设置生成中文，英文设置生成英文。

## Capabilities

### New Capabilities
- `typed-wiki-organization`: 定义 Wiki 页面类型、允许的目录、顶层保留文件、misplaced page 判定与迁移期行为。

### Modified Capabilities
- `workspace-management`: 初始化、reindex 与 index 生成需要遵守 typed wiki 目录契约，并排除模板页。
- `ingest-pipeline`: 生成与 FILE 块应用需要阻止新业务页平铺到 `wiki/` 顶层，并按文档语言设置生成内容。
- `wiki-lint`: 增加顶层业务页、模板污染和类型目录组织问题的 lint 规则。
- `wiki-page-templates`: 模板与模板指导需要配合 typed page 目录，并遵守文档语言设置。
- `workspace-prompt-profile`: 中央 prompt composer 需要把 `doc_language` 作为所有生成/整理默认文本语言的硬约束。

## Impact

- 后端：`internal/engine` 的 page type、lint、index builder、scaffold；`internal/ingest` 的 prompt 与 FILE 块应用；`internal/mcp` 的 structure/audit 诊断。
- API/CLI/MCP：lint 报告将新增 issue code；ingest 可能对非法顶层业务页 FILE 块返回错误。
- 数据：不修改已有文件，但会暴露现有顶层业务页为待整理问题；后续实现可提供迁移任务或由整理模式规划移动。
- 兼容性：`wiki/overview.md`、`wiki/index.md`、`wiki/log.md` 继续允许位于顶层；旧 workspace 可通过重新运行 `llmwiki init` 修复缺失目录。
