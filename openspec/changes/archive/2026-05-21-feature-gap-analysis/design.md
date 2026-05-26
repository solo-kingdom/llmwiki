## Context

本项目 (llmwiki Go) 当前实现了 LLM Wiki 的核心功能，包括：两步骤摄取、FTS5 全文搜索、MCP 工具集（6 个工具）、引用图（cites + links_to）、陈旧性传播、文件监视器、版本控制（Git）、Web UI（7 个视图）、LLM 集成、Provider 实例管理、活动日志等。

在 explore 阶段，已对 Karpathy 原始 LLM Wiki 理念（[gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)）及 4 个参考实现（nashsu/llm_wiki、LLM-Wiki-Skilled、lcasastorian/llmwiki、DAIR-AI/OmegaWiki）进行了详尽的逆向分析。本设计文档产出两个产物：

1. **功能对比矩阵**（`docs/13-feature-comparison-matrix.md`）：跨 6 个来源的全维度功能对比
2. **Gap 分析报告**（`docs/14-gap-analysis-and-roadmap.md`）：本项目的缺失功能识别、优先级分类和推荐实现路线图

核心约束：
- 这是纯文档变更，不涉及代码实现
- 分析基于代码评审（非 spec 文档），反映**实际实现状态**而非计划状态
- 优先级考虑：对核心工作流的阻塞程度 > 参考实现的采纳程度 > 用户需求的普遍性

## Goals / Non-Goals

**Goals:**
- 以 Karpathy 原始 LLM Wiki 文档的功能点为基准线，建立功能对比矩阵
- 识别本项目的功能缺失，按 P0-P3 四级分类
- 为每个 gap 提供根因分析和推荐实现方向
- 输出优先级路线图，指导后续迭代决策

**Non-Goals:**
- 不实现任何代码变更
- 不创建新的 spec 文件（纯分析文档）
- 不对 OmegaWiki 的研究特定功能（9 种实体类型、16 种边类型、并行 worktree 摄入等）进行采纳建议（过于领域特化）
- 不进行性能基准或用户体验评估

## Decisions

### Decision 1: 基准线选择

**选择**: 以 Karpathy 原始 LLM Wiki 文档的功能点为一级基准线，以 4 个参考实现的功能点为二级参照。

**理由**: Karpathy 原始文档定义了 LLM Wiki 模式的最小可行概念——三层架构 + 三大操作 + 两个导航文件。这些是模式的"灵魂"，所有实现都遵循。参考实现在此基础上进行了增强和特化，有些增强是普适的（如两步骤摄取、引用图），有些是领域特化的（如 16 种边类型）。

```
基准线层次:

Layer 0: Karpathy 原始概念（必须满足的最小集）
  └── 三层架构: raw/ wiki/ schema
  └── 三操作: Ingest, Query, Lint
  └── 双文件: index.md, log.md

Layer 1: 普适增强（大多数实现采纳）
  └── purpose.md, overview.md, 两步骤摄取, 引用图, FTS5搜索, 
      文件监视器, MCP/API 交互

Layer 2: 差异化增强（1-2 个实现采纳）
  └── Obsidian 兼容, Web Clipper, 页面合并保护, 向量搜索,
      社区发现, 验证套件
```

### Decision 2: 功能覆盖判定标准

**选择**: 
- `✅` = 功能可用且完整（基于代码评审确认）
- `⚠️` = 部分实现（功能存在但有不完整或有已知 gap）
- `❌` = 未实现
- `—` = 不适用（该实现的定位不需要此功能）

**理由**: 部分实现比"缺失"更需要关注——它可能让用户产生错误预期。例如本项目的 `wiki/index.md` 在 README 和文档中被描述为"应该存在"，但 `llmwiki init` 不会创建它。

### Decision 3: 优先级分类标准

| 级别 | 含义 | 判定依据 |
|:----:|------|----------|
| **P0** | 阻塞核心工作流 | 缺少此功能会导致 LLM 无法正常工作或产生数据丢失 |
| **P1** | Wiki 质量必要 | 缺少此功能会导致 Wiki 质量下降、混乱或难以维护 |
| **P2** | 体验增强 | 缺少此功能会导致用户体验不佳或效率降低 |
| **P3** | 长远增强 | 锦上添花，可在资源充裕时实施 |

### Decision 4: 对比维度

**选择**: 40+ 个功能维度，分为 9 个大类：

1. **工作区基础** — 目录结构、引导文件、初始化
2. **原始源处理** — 文件类型支持、图片处理、Web Clipper
3. **Wiki 页面管理** — 页面类型、页面模板、合并保护、Frontmatter
4. **摄取 Pipeline** — 摄入模式、缓存、队列、并发
5. **搜索与发现** — 索引搜索、全文搜索、向量搜索、引用图
6. **Wiki 健康检查** — Lint、验证、日志、审计
7. **交互接口** — MCP、HTTP API、CLI、Web UI
8. **LLM 集成** — 提供商、模型选择、上下文预算
9. **扩展与兼容** — Obsidian、Git、版本控制、数据可移植性

## Feature Comparison Matrix

完整的对比矩阵输出到 `docs/13-feature-comparison-matrix.md`。以下是核心发现的摘要：

```
                          Karpathy  nashsu   Skilled  lcasastorian  OmegaWiki  本项目
                          ────────  ──────   ───────  ────────────  ────────  ──────
工作区基础
  purpose.md                 —        ✅       —          —           —       ✅
  wiki/index.md              ✅       ✅       ✅         —           ✅      ❌ P0
  wiki/log.md                ✅       ✅       ✅         ✅          ✅      ✅
  wiki/overview.md           —        ✅       —          ✅          —       ✅
  6 种子目录                 4        6+1      4          0           9       3/6 ⚠️

摄取 Pipeline
  两步骤摄取                  —        ✅       —          —           ✅      ✅
  SHA256 增量缓存             —        ✅       —          —           —       ⚠️ P0*
  持久化摄入队列              —        ✅       —          ✅          ✅      ✅
  页面合并保护                —        ✅       —          —           —       ❌ P0

Wiki 页面管理
  页面模板                    —        —        ✅         —           ✅      ❌
  Frontmatter 完整回填        —        —        ✅         ❌          ✅      ✅
  级联删除                    —        ✅       —          —           —       ✅

搜索与发现
  FTS5 全文搜索               —        ❌       —          ✅          —       ✅
  向量搜索 (LanceDB)          —        ✅       —          —           —       ❌ P3
  引用图 (cites+links_to)     —        ❌       —          ✅          ✅      ✅
  知识图谱可视化              —        ✅       —          —           ✅      ❌ P2
  社区发现 (Louvain)          —        ✅       —          —           —       ❌ P3

Wiki 健康检查
  Lint (结构化验证)           ✅        —        ✅         —           ✅      ❌ P1
  Wiki 健康报告               ✅        —        —          —           ✅      ❌ P1
  陈旧性传播                  —        —        —          ✅          —       ✅
  日志契约验证                —        —        ✅         —           ✅      ❌ P2

交互接口
  MCP Server (5+ tools)       —        ❌       —          ✅          ✅      ✅
  HTTP REST API               —        ✅       —          ✅          —       ✅
  Web UI                      —        ✅       —          ✅          ✅      ✅
  CLI                         —        —        —          ✅          —       ✅

扩展与兼容
  Obsidian 兼容 (.obsidian/)  —        ✅       ✅         —           ✅      ❌ P1
  Chrome Web Clipper          —        ✅       —          ✅          —       ❌ P2
  Git 版本控制                —        —        ✅         —           ✅      ✅
  Reindex (删库可恢复)        —        —        —          ⚠️          ✅      ✅
```

> \* SHA256 缓存：仅对文件直接摄取生效，对 job-based `IngestNormalized()` 不生效

## Gap Analysis Summary

### P0: 阻塞核心工作流

| # | Gap | 影响 |
|---|-----|------|
| 1 | **`wiki/index.md` 不生成** | LLM 在查询时无法快速定位相关页面，只能依赖 FTS5 搜索。这与 Karpathy 原始设计的"先读 index 找相关页面"工作流冲突 |
| 2 | **页面合并保护缺失** | LLM 的摄入输出可能覆盖已有 wiki 页面的正文，丢失人工编辑或前序摄入的信息。虽然 frontmatter 的 `type`/`title`/`created` 有锁保护，但正文完全无保护 |
| 3 | **部分 Wiki 子目录缺失** | `wiki/synthesis/`、`wiki/comparisons/`、`wiki/queries/` 目录不会在 `llmwiki init` 时创建。LLM 在摄入时可能创建这些目录，但引导文件不完整 |
| 4 | **SHA256 缓存未覆盖 job-based 摄入** | `IngestNormalized()` 未经缓存检查就调用 LLM pipeline，导致重试或重新提交相同的 normalized 内容时浪费 token |

### P1: Wiki 质量必要

| # | Gap | 影响 |
|---|-----|------|
| 5 | **Lint / Wiki 健康检查缺失** | 无法检测页面间矛盾、过时声明、孤立页面、缺失交叉引用、数据空白。用户只能手动发现这些问题 |
| 6 | **Frontmatter 一致性验证缺失** | 无法确保 `type` 字段与文件所在目录一致（如 `wiki/entities/` 下的页面 type 是否为 `entity`）。LLM-Wiki-Skilled 的 `lint_schema.py` 提供了此验证 |
| 7 | **Obsidian 兼容缺失** | 本项目 Wiki 使用 `[[wikilink]]` 和 YAML frontmatter，技术上已经是 Obsidian 兼容的。但缺少 `.obsidian/` 配置自动生成，用户需要手动配置 |
| 8 | **Wiki 引导文件不完整** | `purpose.md` 和 `wiki/log.md` 的初始化内容过于空白，缺少有效的引导上下文供 LLM 使用。例如 `purpose.md` 只包含占位符文本 |

### P2: 体验增强

| # | Gap | 影响 |
|---|-----|------|
| 9 | **Chrome Web Clipper 缺失** | 用户从网页获取源文件需要手动操作（复制粘贴或下载后拖入），效率低于一键剪藏 |
| 10 | **页面模板缺失** | LLM 创建新页面时无结构化参考，可能导致不同摄入产出的页面格式不一致 |
| 11 | **知识图谱可视化缺失** | 用户无法可视化浏览 Wiki 的关联结构。OmegaWiki 的 Cytoscape 和 nashsu 的 sigma.js 提供了此能力 |
| 12 | **日志契约验证缺失** | `wiki/log.md` 的"仅追加"契约没有工具验证，可能出现 LLM 误操作破坏日志格式 |

### P3: 长远增强

| # | Gap | 影响 |
|---|-----|------|
| 13 | **向量搜索 (LanceDB/其他)** | FTS5 在中等规模足够，但在 500+ 页时语义搜索可能更有效 |
| 14 | **社区发现 (Louvain)** | 帮助识别 Wiki 中的知识簇，但需要图可视化作为前置 |
| 15 | **TUS 可恢复上传** | 大文件上传的可靠性增强，仅在远程服务场景有用 |
| 16 | **定时导入** | 定期自动导入（如每日 arXiv），研究场景有用但通用场景不重要 |
| 17 | **多工作区管理** | 同时管理多个 Wiki 工作区，当前单工作区已经足够 |

## Priority Roadmap

```
Phase 1: 补全核心 (P0) ───── 立即
  ├── wiki/index.md 自动生成 + 摄入后更新
  ├── 页面合并保护（正文 LLM 辅助合并 + 锁定字段）
  ├── 补全 wiki 子目录 (synthesis, comparisons, queries)
  └── SHA256 缓存覆盖 job-based 摄入

Phase 2: 质量保障 (P1) ───── 短期
  ├── Lint / Wiki 健康检查
  │   ├── Frontmatter type-vs-directory 一致性
  │   ├── 孤立页面检测（无入链）
  │   ├── 死链检测（[[wikilink]] 目标不存在）
  │   ├── 陈旧声明检测（依赖 stale_since 数据）
  │   └── 缺失交叉引用检测
  ├── .obsidian/ 配置自动生成
  └── 引导文件内容增强（purpose.md 和 log.md 的初始模板）

Phase 3: 体验提升 (P2) ───── 中期
  ├── 页面模板系统（entity, concept, source, synthesis 的 section 约定）
  ├── 知识图谱可视化（前端集成 react-force-graph-2d 或 Cytoscape.js）
  ├── 日志契约验证（validate_log 等效的 Go 实现）
  └── Web Clipper 扩展（Chrome Extension）

Phase 4: 长远增强 (P3) ───── 后期
  ├── 向量搜索（等 Go 生态的 LanceDB 客户端成熟，或用 Ollama embedding + 手工 ANN）
  ├── 社区发现（依赖知识图谱可视化）
  ├── TUS 可恢复上传
  ├── 定时导入
  └── 多工作区支持
```

## Risks / Trade-offs

**[Risk] 页面合并保护可能引入 LLM 调用开销** — 正文合并需要调用 LLM 比较新旧内容，会增加摄入的 token 消耗。缓解：可以先用简单 diff（文本相似度）判断是否需要合并，仅当差异较大时才调用 LLM。

**[Risk] Lint 功能可能过度设计** — OmegaWiki 的 10+ lint checks 和 LLM-Wiki-Skilled 的验证套件是针对其特定约定的。本项目的 lint 应该从最小可行开始：type-vs-directory 一致性 + 死链检测。

**[Trade-off] index.md 的维护方式** — Karpathy 模式要求 LLM 在每次摄入后更新 index.md。但这意味着 LLM 需要额外的一次写操作。替代方案：让 `reindex` 命令自动生成 index.md（类似 LLM-Wiki-Skilled 的 `rebuild_index.py`），不依赖 LLM。建议采用"reindex 自动生成 + LLM 可选更新"的方式。

**[Trade-off] 是否现在做向量搜索** — nashsu 的混合搜索（关键词 + 向量 RRF）将召回率从 58.2% 提升到 71.4%。但 FTS5 在 100-500 页规模下效果良好。且 Go 生态缺乏 LanceDB 客户端。建议延迟到 P3，等搜索质量成为实际痛点时再投入。
