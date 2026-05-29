# Gap 分析与优先级路线图

> 基于功能对比矩阵（`docs/13-feature-comparison-matrix.md`）中识别的 49 个缺失功能和 6 个部分实现功能，
> 按 P0-P3 四级优先级分类，并提供根因分析、推荐实现方向和依赖关系。

## 分析方法

1. **基准线**: Karpathy 原始 LLM Wiki 概念为第一级基准线
2. **参照系**: 4 个参考实现（nashsu/llm_wiki、LLM-Wiki-Skilled、lcasastorian/llmwiki、OmegaWiki）
3. **验证方式**: 基于 `internal/` 目录的代码评审，非 spec 文档推断
4. **判定标准**: 功能是否存在且完整可用

## 优先级定义

| 级别 | 含义 | 典型特征 |
|:----:|------|----------|
| **P0** | 阻塞核心工作流 | 缺少会导致 LLM 无法正常工作、数据可能丢失、用户无法完成基本任务 |
| **P1** | Wiki 质量必要 | 缺少会导致 Wiki 质量下降、混乱或难以维护，影响长期可用性 |
| **P2** | 体验增强 | 缺少会导致用户体验不佳、效率降低，但不影响核心功能正常运转 |
| **P3** | 长远增强 | 锦上添花的功能，可在资源充裕时实施，或依赖基础设施成熟 |

---

## 一、P0：阻塞核心工作流（4 项）

### P0-1: `wiki/index.md` 不生成 ✅ 已实现

> **状态（2026-05-21）**: `llmwiki init` 创建中文空表格框架；`llmwiki reindex` 末尾通过 `engine/index_builder.go` 幂等重建 `wiki/index.md` 并写入 SQLite 索引。

**影响**:
- LLM 在查询时无法快速定位相关页面。Karpathy 原始设计的工作流是"LLM 先读 index 找相关页面，再深入阅读"
- 虽然 FTS5 全文搜索可以替代部分索引功能，但 index.md 提供了人类也可读的内容目录
- 与 README 和文档中的描述不一致，用户可能有错误预期

**根因**:
`cmd/llmwiki/init.go` 的 `scaffolds` map 中包含 `purpose.md`、`wiki/overview.md`、`wiki/log.md` 的生成逻辑，但没有 `wiki/index.md`。`engine/reindex_test.go:81` 引用了 index.md 但在实际代码中未生成。

**推荐修复方案**:
1. `llmwiki init` 时自动创建空白的 `wiki/index.md`（含按类型分组的基础表格框架）
2. 在有内容的 workspace 中增加 `llmwiki reindex` 自动生成 index.md 的能力（类似 LLM-Wiki-Skilled 的 `rebuild_index.py`）
3. 每次摄入完成后可选更新 index.md

**涉及模块**: `cmd/llmwiki/init.go`, `engine/reindex.go`

---

### P0-2: 页面合并保护缺失 ✅ 已实现

> **状态（2026-05-21）**: `internal/ingest/merge.go` 在 `ApplyWikiBlocks` 写入前合并已有页面：frontmatter 锁定字段 + 数组 union + 正文 LLM 合并（70% 长度 guard）。`llmwiki ingest --force-overwrite` 可跳过合并。

**影响**:
- LLM 的摄入输出直接 `os.WriteFile` 覆盖已有 wiki 页面，不检查旧内容
- 如果前序摄入或人工编辑了某页面，新摄入可能**静默丢失**旧信息
- nashsu 的合并保护包含三层：数组联合（sources/tags/related 确定合并）+ 正文 LLM 辅助合并 + 锁定字段强保护

**根因**:
`internal/ingest/fileblocks.go` 的 `ApplyWikiBlocks()` 直接写入文件，无 diff/merge 逻辑。`ingest/lock.go` 的 `PageLockManager` 只做并发控制，不做内容合并。

**推荐修复方案**:
1. 在写入前读取已有文件内容（如果存在）
2. 对于 frontmatter 字段：`type`/`title`/`created` 强制保护；`sources[]`/`tags[]`/`related[]` 确定性联合（不需要 LLM）
3. 对于正文：计算文本相似度，如果旧内容 ≠ 新内容，构建 merge prompt 让 LLM 合并。合并后检查长度（不低于 70% 的旧内容）
4. 可选：添加 `--force-overwrite` 标志允许跳过合并

**涉及模块**: `internal/ingest/fileblocks.go`, `internal/ingest/`（新增 `merge.go`）

---

### P0-3: Wiki 子目录不完整 ✅ 已实现

> **状态（2026-05-21）**: `engine/scaffold.go` 定义完整目录列表；`llmwiki init` 创建 6 个 wiki 子目录 + `raw/assets/` + `.obsidian/`。

**影响**:
- `llmwiki init` 只创建 `wiki/entities/`、`wiki/concepts/`、`wiki/sources/` 三个子目录
- 缺少 `wiki/synthesis/`（综合分析）、`wiki/comparisons/`（对比分析）、`wiki/queries/`（查询归档）
- LLM 在摄入时可能动态创建这些目录，但：
  - LLM 不知道哪些目录"应该存在"
  - 缺少目录会导致 LLM 生成文件时路径错误
  - 与设计文档不一致

**根因**:
`cmd/llmwiki/init.go` 第 36-45 行的 `dirs` 列表仅包含 3 个 wiki 子目录，未包含 synthesis/comparisons/queries。

**推荐修复方案**:
直接扩展 `dirs` 列表，添加缺失的三个子目录。同时添加 `.gitkeep` 占位文件保持 Git 追踪。

**涉及模块**: `cmd/llmwiki/init.go`

---

### P0-4: SHA256 缓存未覆盖 job-based 摄入 ✅ 已实现

> **状态（2026-05-28）**: `internal/ingest/cache.go` 实现了 `cacheKeyForNormalized()` 和 `lookupCacheForSource()`，`IngestNormalized()` 入口已有完整的 content SHA256 缓存检查。缓存 key 为 `(canonicalPath, contentSHA256)`，命中后跳过 LLM pipeline，附带 `writtenFilesExist()` 校验确保缓存完整性。

**原始问题描述**:
`Ingest()`（文件直接摄入）有 SHA256 缓存，但 `IngestNormalized()`（Web UI / API 主要入口）未做缓存检查，导致重复提交相同内容时重复消耗 LLM token。

**涉及模块**: `internal/ingest/cache.go`, `internal/ingest/pipeline.go`

---

## 二、P1：Wiki 质量必要（4 项）

### P1-1: Lint / Wiki 健康检查缺失 ✅ 已实现（阶段 1）

> **状态（2026-05-28）**: `internal/engine/lint.go` 实现了完整的机械性健康检查（阶段 1），通过 MCP `search` 工具 lint 模式和 Local tools 暴露。已实现检查项：
> - 死链检测（`dead_link`）：解析 `[[wikilinks]]` 和 `[text](path)` 链接，多策略解析目标路径
> - 孤立页面检测（`orphan_page`）：无入链的 wiki 页面（排除系统页和 source 摘要页）
> - Frontmatter type-vs-directory 一致性验证（`type_dir_mismatch`、`missing_frontmatter`）
> - 错位页面检测（`misplaced_wiki_page`）：非 typed 子目录下的业务页面
> - 日志格式验证（`log_format_invalid`、`log_date_decreasing`）：`engine/log_validator.go`
> - Wiki 统计（页数/源数/最后更新日期）
>
> 尚未实现（阶段 2/3）：矛盾检测（需 LLM）、陈旧声明检测、缺失交叉引用检测。

**涉及模块**: `internal/engine/lint.go`, `internal/engine/log_validator.go`, `internal/engine/frontmatter.go`

---

### P1-2: Frontmatter 一致性验证缺失 ✅ 已实现

> **状态（2026-05-28）**: `internal/engine/frontmatter.go` 的 `ValidateFrontmatter()` 函数实现了完整的一致性验证，集成到 `LintWorkspace()` 流程中。验证：`type` 字段与文件所在目录匹配、必需字段（`title`、`type`、`date`）存在性检查、YAML 格式有效性。

**涉及模块**: `internal/engine/frontmatter.go`（`ValidateFrontmatter` 函数）, `internal/engine/lint.go`（集成调用）

---

### P1-3: Obsidian 兼容缺失 ✅ 已实现

> **状态（2026-05-21）**: `llmwiki init` 在缺失时写入 `.obsidian/app.json`（wikilink 模式、frontmatter 显示等最小配置），不覆盖已有文件。

**影响**:
- Karpathy 原始概念中，"Obsidian 是 IDE，LLM 是程序员，Wiki 是代码库"
- 本项目的 Wiki 使用 `[[wikilink]]` 和 YAML frontmatter，**技术上兼容** Obsidian
- 但缺少 `.obsidian/` 配置自动生成，用户需要手动配置才能获得最佳体验

**当前状态**:
项目在 `docs/` 中多次提到 Obsidian 兼容作为"后续迭代"，但无代码实现。

**推荐修复方案**:
在 `llmwiki init` 时创建 `.obsidian/` 目录：
- `app.json`：基础配置（提示使用 graph view 等）
- `community-plugins.json`：推荐 Dataview 插件
- `hotkeys.json`：绑定"下载附件"快捷键（如 Karpathy 推荐）
- 可选：`graph.json`：为 graph view 配置颜色分组

**涉及模块**: `cmd/llmwiki/init.go`

---

### P1-4: 引导文件内容不完整 ✅ 已实现

> **状态（2026-05-21）**: 中文 scaffold（`purpose.md`、`wiki/overview.md`、`wiki/log.md` 含 init 条目）由 `engine/scaffold.go` 提供；仅缺失时写入。

**影响**:
- `llmwiki init` 生成的 `purpose.md` 和 `wiki/log.md` 内容过于空白
- `purpose.md` 只有占位符文本（`# Purpose\n\nDescribe your research goals...`），没有引导 LLM 的结构
- `wiki/log.md` 只有文件头部说明，无历史条目

**当前状态**:
`cmd/llmwiki/init.go` 的 `scaffolds` map 中定义的模板内容过于简单。

**推荐修复方案**:
丰富模板内容：
- `purpose.md`：增加 YAML frontmatter（`goals`、`key_questions`、`scope`），提供引导性提示
- `wiki/log.md`：在第一个条目中记录 init 操作
- `wiki/overview.md`：提供基础结构（项目目标、当前状态、主要主题的占位符）

**涉及模块**: `cmd/llmwiki/init.go`

---

## 三、P2：体验增强（4 项）

### P2-1: Chrome Web Clipper 缺失

**影响**: 用户从网页获取源文件需要手动操作（复制粘贴或下载后拖入），效率低于一键剪藏。

**参考**: nashsu 和 lcasastorian 都提供了 Chrome Extension（Manifest V3），使用 Readability.js 提取正文 + Turndown 转换为 Markdown。

**推荐实现**: 创建 `extension/` 目录，使用 WXT 框架（类似 lcasastorian）或 Manifest V3 原生开发。剪藏内容通过 HTTP API 提交到 llmwiki 服务。

---

### P2-2: 页面模板缺失 ✅ 已实现

> **状态（2026-05-28）**: `internal/engine/templates.go` 定义了 6 种页面模板（entity/concept/source/synthesis/comparison/query），`llmwiki init` 时通过 `WikiPageTemplateFiles()` 写入 `wiki/templates/`。模板包含 frontmatter 示例、必需章节注释和占位内容。生成 prompt 中通过 `engine.TemplateGuidanceForGeneration()` 引导 LLM 参考模板结构。

---

### P2-4: 日志契约验证缺失 ✅ 已实现

> **状态（2026-05-28）**: `internal/engine/log_validator.go` 实现了 `ValidateLogMD()` 函数，验证：条目前缀格式 `## [YYYY-MM-DD] action-type | description`、日期有效性、日期非递减（仅追加契约）。集成到 `LintWorkspace()` 中。

**涉及模块**: `internal/engine/log_validator.go`, `internal/engine/lint.go`

---

### P2-3: 知识图谱可视化缺失

**影响**: 用户无法可视化浏览 Wiki 中页面之间的关联结构。

**参考**: nashsu 使用 sigma.js + ForceAtlas2 布局；OmegaWiki 使用 Cytoscape.js；lcasastorian 后端有 `react-force-graph-2d`。

**推荐实现**: 前端新增一个 GraphView 组件，使用 `react-force-graph-2d`（已在前端依赖中，来自 lcasastorian 的 web/package.json），从 `/api/v1/graph` 端点获取边数据。

---

## 四、P3：长远增强（5 项）

### P3-1: 向量搜索

**现状**: 只有 FTS5 关键词搜索。nashsu 的混合搜索（关键词 + 向量 RRF）将召回率从 58.2% 提升到 71.4%。

**阻塞因素**: Go 生态缺乏 LanceDB 客户端（Rust 原生）。替代方案：用 Ollama embedding API + 手动余弦相似度（性能有限）。

**推荐时机**: 当 Wiki 超过 500+ 页面且 FTS5 搜索出现明显质量问题时。

---

### P3-2: 社区发现 (Louvain)

**现状**: nashsu 使用 graphology + Louvain 算法检测知识簇，识别桥接节点、孤立社区。

**依赖**: 需要知识图谱可视化（P2-3）作为前置，否则社区发现结果无处展示。

**推荐时机**: 知识图谱可视化完成后。

---

### P3-3: TUS 可恢复上传

**现状**: lcasastorian 支持 TUS 协议用于大文件上传，用于远程服务场景。

**推荐时机**: 远程服务成为核心使用场景时。

---

### P3-4: 定时导入

**现状**: OmegaWiki 的 `/daily-arxiv` 通过 GitHub Actions 每天自动获取 arXiv 新论文。nashsu 有 `scheduled-import` 功能。

**推荐时机**: 有用户需要定期自动导入场景时（如监控某个 RSS 源）。

---

### P3-5: 多工作区管理

**现状**: 当前单 workspace 设计足够。MCP server 和 HTTP API 都已经支持多 workspace 发现。

**推荐时机**: 用户需要同时管理多个 Wiki 工作区时。

---

## 五、优先级路线图

```
Phase 1: 补全核心 (P0) ───── ✅ 全部已完成
┌────────────────────────────────────────────────────────┐
│ P0-1  wiki/index.md 自动生成 + reindex 集成  ✅          │
│ P0-2  页面合并保护                           ✅          │
│ P0-3  补全 wiki 子目录                       ✅          │
│ P0-4  SHA256 缓存覆盖 job-based 摄入         ✅          │
└────────────────────────────────────────────────────────┘

Phase 2: 质量保障 (P1) ───── ✅ 全部已完成
┌────────────────────────────────────────────────────────┐
│ P1-1  Lint / Wiki 健康检查 (阶段1: 机械检查)  ✅          │
│ P1-2  Frontmatter 一致性验证                  ✅          │
│ P1-3  .obsidian/ 配置自动生成                 ✅          │
│ P1-4  引导文件内容增强                        ✅          │
└────────────────────────────────────────────────────────┘

Phase 3: 体验提升 (P2) ───── 进行中
┌────────────────────────────────────────────────────────┐
│ P2-1  Web Clipper 扩展 ────────── 待开始                 │
│ P2-2  页面模板系统                           ✅          │
│ P2-3  知识图谱可视化 ──── 待开始                         │
│ P2-4  日志契约验证                           ✅          │
└────────────────────────────────────────────────────────┘

Phase 4: 长远增强 (P3) ───── 后期 (按需)
┌────────────────────────────────────────────────────────┐
│ P3-1  向量搜索 ──── 等 Go LanceDB 客户端成熟             │
│ P3-2  社区发现 ──── 依赖 P2-3 图谱可视化                 │
│ P3-3  TUS 上传 ──── 远程服务场景需要时                   │
│ P3-4  定时导入 ──── 用户需求驱动                         │
│ P3-5  多工作区 ──── 当前单 workspace 足够                │
└────────────────────────────────────────────────────────┘
```

---

## 六、附录 A：与参考实现的差异总结

以下是本项目**有意不采纳**的参考实现功能及理由：

| 功能 | 来源 | 不采纳理由 |
|------|------|-----------|
| 9 种实体类型 + 16 种边类型 | OmegaWiki | 过于领域特化（学术研究），对通用 Wiki 是过度设计 |
| 并行 worktree 摄入 | OmegaWiki | Git worktree 复杂度高，当前规模下串行摄入足够；且本项目已有持久化队列 |
| YAML-only Schema | OmegaWiki | Go 项目中 schema 在代码中定义更自然，不引入 YAML 运行时依赖 |
| 验证套件 (TDD fixtures) | LLM-Wiki-Skilled | 验收测试在 OpenSpec 层面更合适，不需要单独的 `verification/` 目录 |
| AGENTS.md (LLM 契约文档) | LLM-Wiki-Skilled | 本项目通过 MCP `guide` 工具 + API 文档向 LLM 传达工作方式 |
| 跨模型审核 (cross-model review) | OmegaWiki | 仅学术研究场景需要，通用场景无需独立审核 LLM |
| Claude Code CLI 子进程 | nashsu | 本项目直接通过 HTTP API 调用 LLM，不依赖 CLI 子进程 |
| 本地 Web UI 之外的独立进程 | lcasastorian | 本项目通过 Go embed 将 Web UI 打包为单二进制 |
| Milkdown WYSIWYG 编辑器 | nashsu | 本项目定位为 wiki reader（只读），不是编辑器 |
| TUS 可恢复上传 | lcasastorian | 当前本地文件直接写入，无需 TUS 协议 |

---

## 附录 B：当前已实现功能回顾

> **更新（2026-05-28）**: P0 全部 4 项、P1 全部 4 项、P2 中 2 项（模板 + 日志验证）已实现。

本项目当前已实现 **约 100 个功能点**（包括 ✅ 和 ⚠️），核心包括：

**工作区基础** (12): 三层架构、purpose.md、log.md、overview.md、index.md（自动生成）、workspace init、reindex、raw/sources+assets、不可变策略、.llmwiki/、.obsidian/ 自动配置

**原始源处理** (5): Markdown/文本、PDF 提取、Office 文档、SHA256 去重、tiered 处理

**Wiki 页面管理** (9): entity/concept/source 类型、frontmatter 回填、frontmatter 一致性验证、级联删除、wikilink 解析、markdown 链接解析、页面保护、文件名 slug、错位页面检测

**摄取 Pipeline** (12): 两步骤摄入、CoT 嵌入、持久化队列、全局串行、进度可视化、重试/取消、两阶段重试、Session 摄入、FILE 块解析、路径沙箱、SHA256 缓存（含 IngestNormalized）、页面合并保护（三层）

**搜索与发现** (11): FTS5 搜索、上下文片段、文件浏览、tag 过滤、引用图 cites+links_to、反向链接、未引用源检测、陈旧页面+传播

**Wiki 健康** (4): 数据结构审计（FileTruth/DBDerived）、Lint 健康检查（死链/孤立/frontmatter/错位/日志）、日志格式验证、Wiki 统计

**交互接口** (30): MCP 6 工具、HTTP API 9+ 端点、Web UI 7 视图（含 wiki reader、文件树、大纲、搜索、摄入 Hub/聊天、Jobs、Timeline、活动日志、Settings、Provider 管理）、CLI 4 命令

**LLM 集成** (8): OpenAI+Anthropic 兼容、Provider 实例+预设、参数控制、流式响应、推理检测、健康探测、超时策略

**扩展与兼容** (7): Git 版本控制、ingest commit、智能回滚、Timeline 视图、文件数据可移植性、跨平台、远程服务

**页面模板** (6): entity/concept/source/synthesis/comparison/query 六种模板

**部分实现** (2): 图片提取不完整、知识图谱可视化未实现
