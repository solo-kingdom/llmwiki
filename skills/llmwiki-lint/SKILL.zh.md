---
name: llmwiki-lint
description: 检查并修复 LLM Wiki 的健康问题。当用户需要诊断 wiki 问题，或在其他操作中发现异常时使用。
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
  lang: zh
---

检查 LLM Wiki 健康 — 发现并修复死链、孤立页面、frontmatter 问题和结构性问题。

本 skill 是健康诊断与整理类 prompts 的蓝本，主要影响 organize 模式、lint 报告解释、以及后续 LLM 参与的质量检查提示。确定性 lint 由 Go 代码执行；prompt 负责解释、排序和提出修复方案。

## 何时使用

- 用户说"检查 wiki 健康"、"lint"、"诊断"
- 重大重组前后
- 批量摄入后验证一致性
- 在其他操作中发现死链或不一致时

## 核心不变量

- `raw/` 只读，lint 修复不能改源材料。
- 文件系统是真理源；lint 报告来自 wiki 文件和可重建索引。
- 修复前先读取受影响页面，避免为消除告警而丢失信息。
- `wiki/log.md` 仅追加；格式修复应最小化，不删除历史条目。
- Session 诊断阶段只报告问题和修复建议；归档确认后才进入计划/生成步骤。

## 步骤

1. **运行 lint 检查**，使用 MCP `search`：
   ```
   search(query="", mode="lint")
   ```

2. **审阅报告** — 问题按严重度分类：

   | 严重度 | 问题类型 | 处理方式 |
   |:---:|------|------|
   | **error** | 死链、缺少 frontmatter、日志格式错误 | 立即修复 |
   | **warning** | 孤立页面、类型不匹配、错位页面 | 评估后修复 |

3. **优先修复 error 级问题**：

   **死链**（`dead_link`）：
   - 查找链接目标 — 页面是否被重命名或删除？
   - 创建缺失的页面，或更新链接指向正确目标
   - 用 `read` 查看页面，用 `write` 修复链接

   **缺少 frontmatter**（`missing_frontmatter`）：
   - 读取页面，确定其类型和标题
   - 使用 `write` 添加正确的 frontmatter

   **日志格式错误**（`log_format_invalid`、`log_date_decreasing`）：
   - 读取 `wiki/log.md`
   - 修复条目格式以匹配规范：`## [YYYY-MM-DD] action | description`
   - 确保日期非递减（仅追加；不要删除历史条目）

4. **修复 warning 级问题**：

   **孤立页面**（`orphan_page`）：
   - 读取页面了解其内容
   - 找到应链接到它的相关页面
   - 从那些页面添加 `[[wikilinks]]`

   **类型不匹配**（`type_dir_mismatch`）：
   - 将页面移到正确目录，或更新其 `type` 字段

   **错位页面**（`misplaced_wiki_page`）：
   - 移到正确的类型子目录

5. **重新运行 lint** 验证所有修复
   ```
   search(query="", mode="lint")
   ```
   如果仍有 error，继续修复；warning 可在说明原因后延后处理。

## Lint 检查项参考

| 检查码 | 严重度 | 检查内容 |
|------|:---:|------|
| `dead_link` | error | `[[链接]]` 或 `[文本](路径)` 的目标不存在 |
| `missing_frontmatter` | error | 缺少必需字段：title、type、date |
| `log_format_invalid` | error | `log.md` 条目格式不符合规范 |
| `log_date_decreasing` | error | 日志条目日期未按升序排列 |
| `type_dir_mismatch` | warning | 页面 `type` 与所在目录不匹配 |
| `misplaced_wiki_page` | warning | 业务页面不在类型子目录中 |
| `orphan_page` | warning | 没有其他页面链接到此页面 |

## 修复策略

- **死链**：优先确认是否有重命名页面或 slug 差异；无法确认时，创建占位页前先询问或标记 open question。
- **Frontmatter**：按目录推断 type，但不要随意改业务身份字段；缺日期时使用当前修复日期。
- **孤立页**：先判断是否是合法孤立（如 source 摘要或临时查询页）；否则从相关总览、实体或概念页增加链接。
- **错位页 / type mismatch**：优先让 type 与目录保持一致；移动页面后同步更新指向旧路径的链接。
- **日志问题**：只修格式和顺序问题；不得重写历史含义。

## 约束

- 变更后必须重新运行 lint，不能只在变更前运行
- 先修复 error，再处理 warning
- 修复死链时，优先创建缺失页面，而非删除链接
- 绝不修改 `raw/` 目录
- `wiki/log.md` 严格仅追加 — 只修复格式，绝不删除条目；标准条目前缀为 `## [YYYY-MM-DD] action | description`
- 如果一个页面有多个问题，一次性全部修复
- `overview.md`、`index.md`、`log.md` 是系统页，避免作为普通业务页移动或删除

## 完成标准

- [ ] Lint 报告显示 0 个 error
- [ ] 所有死链已解决（已创建页面或已更新链接）
- [ ] 所有页面 frontmatter 有效
- [ ] `wiki/log.md` 格式正确且日期升序
- [ ] warning 级问题已审阅，已修复或明确推迟
- [ ] 修复后已回读关键页面，确认没有丢失旧信息
