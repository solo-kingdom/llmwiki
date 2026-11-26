## Wiki 健康检查

Lint 检查帮助发现 Wiki 中的问题。当前支持以下检查项：

| 检查项 | 严重度 | 说明 |
|--------|:---:|------|
| 死链 | error | `[[链接]]` 或 `[文本](路径)` 的目标页面不存在 |
| 缺少 Frontmatter | error | 缺少必需的 frontmatter 字段（title/type/date） |
| 日志格式错误 | error | `log.md` 中的条目格式不符合规范 |
| 日志日期逆序 | error | 日志条目的日期未按递增排列（违反仅追加契约） |
| 类型不匹配 | warning | 页面 `type` 字段与所在目录不一致 |
| 错位页面 | warning | 业务页面不在对应类型的子目录下 |
| 孤立页面 | warning | 没有其他页面链接到此页面 |

**触发方式**：
- 通过 MCP Agent 调用 `search` 工具（mode=`lint`）
- 在 Organize 模式对话中，AI 会自动调用 `audit` 工具
- 未来将在 Web UI 中提供一键检查入口

报告中的 **error** 级问题建议立即处理，**warning** 级问题可评估后处理。
