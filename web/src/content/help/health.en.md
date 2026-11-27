## Wiki Health

Lint checks help you find issues in your wiki. Currently supported checks:

| Check | Severity | Description |
|-------|:--------:|-------------|
| Dead link | error | `[[link]]` or `[text](path)` target does not exist |
| Missing frontmatter | error | Required frontmatter fields missing (title/type/date) |
| Misplaced page | warning | Business page placed at top-level `wiki/*.md` instead of a topic folder |
| Orphan page | warning | No other active pages link to this page |
| Review overdue | warning | Page is past its `review_after` date |

**How to trigger**:
- Via MCP Agent: call `search` tool with mode=`lint`
- In Organize mode: AI automatically calls the `audit` tool
- Via CLI: `llmwiki lint`

**error**-level issues should be fixed promptly; **warning**-level issues can be evaluated case by case.
