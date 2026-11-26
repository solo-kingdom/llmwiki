## Wiki Health

Lint checks help you find issues in your wiki. Currently supported checks:

| Check | Severity | Description |
|-------|:--------:|-------------|
| Dead link | error | `[[link]]` or `[text](path)` target does not exist |
| Missing frontmatter | error | Required frontmatter fields missing (title/type/date) |
| Log format invalid | error | Entry format in `log.md` does not match spec |
| Log date decreasing | error | Log entries not in chronological order (violates append-only contract) |
| Type mismatch | warning | Page `type` field does not match its directory |
| Misplaced page | warning | Business page not in its typed subdirectory |
| Orphan page | warning | No other pages link to this page |

**How to trigger**:
- Via MCP Agent: call `search` tool with mode=`lint`
- In Organize mode: AI automatically calls the `audit` tool
- Future: one-click check from Web UI

**error**-level issues should be fixed promptly; **warning**-level issues can be evaluated case by case.
