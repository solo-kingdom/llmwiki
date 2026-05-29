---
name: llmwiki-query
description: 查询和重组 LLM Wiki。当用户针对 wiki 内容提问，或想要重构、合并、优化 wiki 结构时使用。
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
  lang: zh
---

查询已有 wiki 知识或重组 wiki 结构。

本 skill 是查询与整理类 Go prompts 的蓝本，主要映射到 `StepSessionQA`、`StepPlanQA`、`StepSessionOrganize` 和 `StepPlanOrganize`。`skills/` 负责沉淀外部资料中的工作流，`internal/ingest/prompts.go` 负责运行时落地。

## 何时使用

- 用户针对 wiki 中的主题提问
- 用户说"我们对 X 了解多少？"、"X 和 Y 有什么关系？"
- 用户想重构、合并或重组页面
- 用户说"清理一下 wiki"、"合并重复"、"重组"

## 核心不变量

- 回答必须基于已有 wiki 页面、源摘要或用户本轮提供的材料。
- 找不到证据时明确说 wiki 尚未覆盖，不要补造事实。
- 重组前必须读取页面；合并/移动后必须验证链接和 frontmatter。
- `raw/` 只读；`wiki/log.md` 仅追加，格式为 `## [YYYY-MM-DD] action | description`。

## 两种模式

### QA 模式（回答问题）

1. **搜索**相关页面：
   ```
   search(query="主题", mode="search")
   search(query="别名/缩写/英文或中文变体", mode="search")
   ```
   如果首次无结果，扩大或替换关键词。FTS5 对 CJK 的召回可能受 tokenizer 影响，不要只依赖一次精确搜索。

2. **阅读**最相关的页面：
   ```
   read(path="wiki/entities/主题.md")
   ```

3. **查看引用关系**：
   ```
   search(query="document-id", mode="references")
   ```
   `references` 当前按 document ID 查询；如果当前上下文没有 ID，prompt 应允许模型改用 `search` / `read` 建立依据。有 Local tools 时可使用 `references(query="document-id")`。

4. **综合回答**，基于 wiki 内容作答
   - 引用具体页面："根据 [[实体名称]]……"
   - 如果 wiki 尚未覆盖该主题，明确说明
   - 可选：建议为新发现的空白创建页面
   - 如果页面之间存在冲突，列出冲突来源和不确定性

5. **归档**有价值的问答（如果用户需要）：
   ```
   StepPlanQA → 计划 JSON → StepGeneration → FILE 块写入 wiki/queries/
   ```
   归档前说明会写入 `wiki/queries/`；计划阶段只输出计划，不直接写文件。

### Organize 模式（重组结构）

1. **获取目录结构**和**健康诊断**：
   ```
   search(query="", mode="list")    → 所有页面
   search(query="", mode="lint")    → 健康检查
   ```
   运行时 organize prompt 应优先要求模型使用：
   ```
   structure()  → 目录树、页面计数、空目录
   audit()      → 死链、孤立页、metadata、统计
   gaps()       → 缺失页面或未引用来源
   similar()    → 相似页面候选
   references() → 引用关系
   ```

2. **识别问题**：
   - 重复或高度相似的页面
   - 孤立页面（无入链）
   - 错位页面（目录不对）
   - 缺失的交叉引用
   - 死链

3. **规划重组方案**：
   - 哪些页面需要合并
   - 哪些需要移动/重命名
   - 需要添加哪些新的交叉引用
   - 需要填补哪些空白

4. **规划或执行变更**
   - 更新前先 `read` 所有受影响页面
   - 删除前确认不是系统页，也不是唯一来源承载页
   - `overview.md`、`index.md`、`log.md` 应视为系统页，不做普通删除对象
   - `StepPlanOrganize` 只输出计划 JSON；确认后由 `StepGeneration` 输出 FILE 块

5. **验证**重组后的 wiki 通过 lint 检查

## 搜索技巧

- 使用具体的实体/概念名称效果最佳
- 搜索使用 SQLite FTS5 — 支持短语查询（`"精确短语"`）
- 首次搜索无结果时，尝试同义词、别名、大小写、英文/中文变体或更宽泛查询
- 对中文、日文等 CJK 内容，不要假设自动分词一定理想；可改用短词、关键字组合、页面列表和引用图辅助

## 约束

- 回答必须基于已有 wiki 内容 — 绝不编造事实
- 如果 wiki 不包含相关信息，明确说明"wiki 尚未涵盖此主题"
- 重组时，合并前必须先阅读页面 — 理解你要合并的内容
- 绝不删除 `wiki/overview.md`、`wiki/index.md` 或 `wiki/log.md`
- 合并页面时，保留两个来源的所有独特信息
- 重组后保持 frontmatter 一致
- 在对话中记录重大结构变更，让用户知晓
- Session 阶段只回答、诊断和规划；归档确认后才进入计划/生成步骤

## 完成标准

### QA 模式
- [ ] 已充分搜索相关页面
- [ ] 已阅读并理解相关内容
- [ ] 回答基于 wiki 内容并附有引用
- [ ] 已说明 wiki 覆盖范围的空白
- [ ] 如归档问答，已写入 `wiki/queries/` 并回读验证

### Organize 模式
- [ ] 已进行健康诊断（lint 检查）
- [ ] 已识别所有结构问题
- [ ] 已执行重组方案
- [ ] 变更后无死链或损坏的引用
- [ ] 移动/合并后的页面 frontmatter 正确
- [ ] 重大结构变化已向用户说明，必要时更新索引或日志
