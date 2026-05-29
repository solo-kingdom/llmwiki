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

## 何时使用

- 用户提供文件、文本或 URL 要求摄入
- 用户说"把这个加到 wiki"、"消化一下"、"摄入"
- 用户想用新信息更新已有 wiki 页面

## 前置条件

- 如果是首次接触该工作区，先运行 `/llmwiki-guide`
- 阅读 `purpose.md` 和 `rules.md` 以了解写作规范

## 步骤

1. **理解源材料**
   - 文件：读取其内容
   - URL：抓取并提取文本
   - 纯文本：审阅其中的关键实体、概念和关系
   - 对话：总结需要摄入的要点

2. **搜索已有的相关页面**，使用 MCP `search`：
   ```
   search(query="主题名称", mode="search")
   ```
   用 `read` 读取匹配的页面，避免重复创建。

3. **规划要创建/更新的内容**
   - 从源材料中识别实体、概念和关系
   - 确定页面类型（entity/concept/source/synthesis/comparison）
   - 对于已有页面：规划要添加的内容（合并而非覆盖）

4. **写入 wiki 页面**，使用 MCP `write`：
   ```
   write(path="wiki/entities/new-entity.md", content="...")
   ```

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

5. **交叉引用**：在相关页面之间添加 `[[wikilinks]]`

6. **验证**：回读已写入的页面确认正确

## 页面类型 → 目录映射

| 类型 | 目录 | 用途 |
|------|------|------|
| entity | `wiki/entities/` | 人物、组织、产品 |
| concept | `wiki/concepts/` | 概念与术语 |
| source | `wiki/sources/` | 源文件摘要 |
| synthesis | `wiki/synthesis/` | 跨源综合分析 |
| comparison | `wiki/comparisons/` | 对比分析 |
| query | `wiki/queries/` | 归档的问答 |

## 合并保护

写入已有页面时，系统默认合并而非覆盖：
- **锁定字段**：`type`、`title`、`created` 永远不会被覆盖
- **数组字段**：`tags`、`sources`、`related` 联合合并（去重）
- **正文**：LLM 智能合并新旧内容

## 约束

- 写入前必须搜索，避免创建重复页面
- 遵循 `purpose.md` 的研究范围 — 不摄入超出研究领域的主题
- 遵循 `rules.md` 的写作规范 — 语气、引用风格、语言
- 每个论断必须可追溯到来源或已有 wiki 页面（禁止编造）
- 使用 `[[wikilinks]]` 进行内部引用，而非纯文本名称
- `wiki/log.md` 仅支持追加 — 绝不重排或删除条目
- 绝不修改 `raw/` 目录的内容
- 源文件摘要应放在 `wiki/sources/`，而非直接写在 entity/concept 页面中

## 完成标准

- [ ] 源材料中的所有关键实体和概念都有对应的 wiki 页面
- [ ] 相关页面之间已添加交叉引用（`[[wikilinks]]`）
- [ ] 没有创建重复页面（已通过搜索确认）
- [ ] Frontmatter 完整（title、type、date、tags）
- [ ] 如从文件摄入，`wiki/sources/` 中存在源文件摘要页
