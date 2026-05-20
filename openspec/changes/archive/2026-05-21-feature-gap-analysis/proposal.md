## Why

项目已实现 LLM Wiki 的核心功能（两步骤摄取、FTS5 搜索、MCP 工具集、引用图、版本控制、Web UI），但缺少一份系统性的功能对比分析来回答三个关键问题：

1. **相对于 Karpathy 原始 LLM Wiki 愿景，我们还缺什么？**
2. **相对于 4 个参考实现（nashsu、LLM-Wiki-Skilled、lcasastorian、OmegaWiki），我们有哪些差异？**
3. **这些缺失的功能应该如何排优先级？**

没有这份分析，后续的迭代决策缺少依据——不确定先做 wiki 健康检查还是先做 Obsidian 兼容，不确定哪些是"真正阻塞工作流"的 gap 还是"锦上添花"的增强。

## What Changes

- **新增功能对比矩阵**：以 Karpathy 原始 LLM Wiki 文档为蓝本，逐项对比 4 个参考实现 + 本项目的功能覆盖情况
- **新增 gap 分析报告**：识别本项目缺失的功能，按 P0（阻塞核心工作流）/ P1（wiki 质量必要）/ P2（体验增强）/ P3（长远增强）四级分类
- **新增优先级路线图**：基于 gap 分析，给出推荐的实现顺序和依赖关系
- **补充和更新已有文档**：
  - 更新 `docs/02-reference-implementations.md` — 已在 explore 阶段更新，加入 LLM-Wiki-Skilled 和 OmegaWiki 的链接
  - 新增 `docs/reference/llm-wiki-skilled.md` — 已在 explore 阶段创建
  - 新增 `docs/reference/omegawiki.md` — 已在 explore 阶段创建
  - 新增 `docs/11-comprehensive-synthesis.md` — 已在 explore 阶段创建
  - 新增 `docs/12-wiki-directory-organization.md` — 已在 explore 阶段创建
  - **新增** `docs/13-feature-comparison-matrix.md` — 功能对比矩阵（本次产出）
  - **新增** `docs/14-gap-analysis-and-roadmap.md` — gap 分析和优先级路线图（本次产出）

## Capabilities

### New Capabilities
- `feature-comparison-matrix`: 跨 6 个来源（Karpathy 原版 + 4 个实现 + 本项目）的功能对比矩阵，覆盖 40+ 功能维度
- `gap-analysis-roadmap`: 本项目功能缺失的识别、分类（P0-P3）、根因分析和推荐实现顺序

## Impact

- **仅文档变更**：不涉及代码修改，不新增 API，不修改数据库 schema
- **新增文件**：
  - `docs/13-feature-comparison-matrix.md`（功能对比矩阵）
  - `docs/14-gap-analysis-and-roadmap.md`（gap 分析和路线图）
- **不修改已有代码**：纯粹的分析和文档产出
