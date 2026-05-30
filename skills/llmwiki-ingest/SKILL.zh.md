---
name: llmwiki-ingest
description: 将源材料摄入 LLM Wiki。当用户需要从文件、文本、URL 或对话中提取知识写入 wiki 时使用。
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
  lang: zh
---

将源材料摄入 LLM Wiki — 分析内容、生成 wiki 页面、更新交叉引用。

本 skill 是摄入类 Go prompts 的蓝本，主要映射到 `StepAnalysis`、`StepGeneration`、`StepMergeBody` 和 `StepRollback`。`skills/` 先沉淀外部资料中的工作流与约束，`internal/ingest/prompts.go` 再把这些原则转化为运行时提示。

## 何时使用

- 用户提供文件、文本或 URL 要求摄入
- 用户说"把这个加到 wiki"、"消化一下"、"摄入"
- 用户想用新信息更新已有 wiki 页面

## 前置条件

- 如果是首次接触该工作区，先运行 `/llmwiki-guide`
- 阅读 `purpose.md` 和 `rules.md` 以了解写作规范
- 确认材料属于 `purpose.md` 范围；超出范围时先向用户说明
- 摄入前做隐私和敏感信息自查，具体保留/脱敏策略遵循 `rules.md`

## 核心不变量

- `raw/` 只读；不要编辑、移动或重写源文件。
- 文件系统是真理源；SQLite/FTS5 索引可重建。
- 每个事实性论断必须能追溯到源材料或已有 wiki 页面。
- 写入已有页面前必须 `read` 原页面，合并时保留旧信息。
- `wiki/log.md` 仅追加，条目格式为 `## [YYYY-MM-DD] action | description`。

## 步骤

1. **理解源材料**
   - 文件：读取其内容
   - URL：抓取并提取文本
   - 纯文本：审阅其中的关键实体、概念和关系
   - 对话：总结需要摄入的要点
   - 大材料：分块处理，并记录每一块与来源的对应关系

2. **搜索已有的相关页面**，使用 MCP `search`：
   ```
   search(query="主题名称", mode="search")
   search(query="别名或英文/中文变体", mode="search")
   ```
   用 `read` 读取匹配页面，避免重复创建。对重要实体/概念至少尝试别名、缩写、中文/英文变体。

3. **规划要创建/更新的内容**
   - 从源材料中识别实体、概念和关系
   - 确定页面类型（entity/concept/source/synthesis/comparison/query）
   - 为源材料创建或更新 `wiki/sources/` 摘要页
   - 对于已有页面：列出新增事实、需保留旧事实、需增加的交叉引用

4. **生成 wiki 页面**，运行时使用 FILE 块：
   ```
   ---FILE: wiki/entities/new-entity.md
   ...
   ---END FILE---
   ```
   如果在 MCP 文档或外部工具说明中描述写入，`write` 的 `path` 是目标目录，文件名由 `title` 生成；但代码内摄入 prompt 应优先描述 FILE 块协议。

   每个页面必须包含 frontmatter：
   ```yaml
   ---
   title: 页面标题
   type: entity
   date: 2026-05-29
   tags: [标签1, 标签2]
   sources: [来源标识]
   ---
   ```

   注意：生成 prompt 不应假设可以覆盖旧页。更新已有页面时，先通过 `read` 获取旧内容，并在 FILE 块中保留旧信息、增量整合新信息。

5. **交叉引用与证据**
   - 在相关页面之间添加 `[[wikilinks]]`
   - 在来源摘要页列出关键观点、涉及实体/概念、后续问题
   - 对实体/概念页新增事实时，标明来自哪个 source 或已有页面
   - 遇到冲突事实时保留冲突上下文，不要直接用新材料覆盖旧说法

6. **验证**
   - 回读已写入页面确认 frontmatter、正文、链接和来源都正确
   - 运行 `search(query="", mode="lint")` 检查死链、frontmatter、日志格式等问题
   - 如修改了系统页或结构页，确认 `wiki/index.md` / `wiki/log.md` 仍符合约定

## 页面类型 → 目录映射

| 类型 | 目录 | 用途 |
|------|------|------|
| entity | `wiki/entities/` | 人物、组织、产品 |
| concept | `wiki/concepts/` | 概念与术语 |
| source | `wiki/sources/` | 源文件摘要 |
| synthesis | `wiki/synthesis/` | 跨源综合分析 |
| comparison | `wiki/comparisons/` | 对比分析 |
| query | `wiki/queries/` | 归档的问答 |

## 合并策略

服务内置摄入 pipeline 有三层合并保护（锁定字段、数组 union、正文 LLM 合并）。prompt 仍必须主动要求模型生成可合并内容，而不是依赖后处理兜底：

- **先读旧页**：更新前通过工具读取目标页面和相关页面。
- **保留锁定语义**：不要随意改变 `type`、`title`、`created` 等身份字段。
- **合并数组字段**：`tags`、`sources`、`related` 应去重合并。
- **合并正文**：保留旧信息，追加或整合新事实；不确定时标记冲突或 open question。

## 约束

- 写入前必须搜索，避免创建重复页面
- 遵循 `purpose.md` 的研究范围 — 不摄入超出研究领域的主题
- 遵循 `rules.md` 的写作规范 — 语气、引用风格、语言
- 每个论断必须可追溯到来源或已有 wiki 页面（禁止编造）
- 使用 `[[wikilinks]]` 进行内部引用，而非纯文本名称
- `wiki/log.md` 仅支持追加 — 绝不重排或删除条目
- 绝不修改 `raw/` 目录的内容
- 源文件摘要应放在 `wiki/sources/`，而非直接写在 entity/concept 页面中
- 在 `StepPlan` 阶段只给出计划 JSON，不输出 FILE 块；在 `StepGeneration` 阶段才输出 FILE 块

## 完成标准

- [ ] 源材料中的所有关键实体和概念都有对应的 wiki 页面
- [ ] 相关页面之间已添加交叉引用（`[[wikilinks]]`）
- [ ] 没有创建重复页面（已通过搜索确认）
- [ ] Frontmatter 完整（title、type、date、tags）
- [ ] 如从文件摄入，`wiki/sources/` 中存在源文件摘要页
- [ ] 更新已有页面时已保留旧信息和旧来源
- [ ] 已回读写入页面并运行 lint，error 级问题已修复
