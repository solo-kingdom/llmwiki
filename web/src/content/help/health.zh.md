## Wiki 健康检查

Lint 检查帮助发现 Wiki 中的问题。当前支持以下检查项：

| 检查项 | 严重度 | 说明 |
|--------|:---:|------|
| 死链 | error | `[[链接]]` 或 `[文本](路径)` 的目标页面不存在 |
| 缺少 Frontmatter | error | 缺少必需的 frontmatter 字段（title/type/date） |
| 错位页面 | warning | 业务页面写在 `wiki/` 顶层，未放入主题子目录 |
| 孤立页面 | warning | 没有其他活跃页面链接到此页面 |
| 复审过期 | warning | 已过 `review_after` 复审日期 |

**触发方式**：
- 通过 MCP Agent 调用 `search` 工具（mode=`lint`）
- 在 Organize 模式对话中，AI 会自动调用 `audit` 工具
- 使用 CLI：`llmwiki lint`

报告中的 **error** 级问题建议立即处理，**warning** 级问题可评估后处理。
