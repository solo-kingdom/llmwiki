## Context

参考实现：
- LLM-Wiki-Skilled: `lint_schema.py`, `validate_log.py`
- OmegaWiki: `tools/lint.py`

本项目已有：
- `engine/frontmatter.go` — 解析但不验证
- `engine/reference_parser.go` — wikilink 解析
- `store` — 引用图、backlinks 查询

## Goals / Non-Goals

**Goals:**

- 纯 Go 机械 lint，无 LLM 调用
- 结构化 JSON 报告（severity, code, message, path）
- CLI / HTTP / MCP 三入口一致结果
- 中文 error message（面向 Web UI）

**Non-Goals:**

- 自动修复
- CI 集成（后续）

## Decisions

### Decision 1: Lint 报告结构

```go
type LintIssue struct {
    Severity string // error | warning | info
    Code     string // dead_link | orphan_page | type_mismatch | log_format | ...
    Path     string
    Message  string
    Line     int    // optional
}

type LintReport struct {
    Issues   []LintIssue
    Stats    LintStats // page_count, source_count, last_updated
    CheckedAt time.Time
}
```

### Decision 2: 检查项

| Code | Severity | 规则 |
|------|----------|------|
| `dead_link` | error | wikilink 目标文件不存在 |
| `orphan_page` | warning | wiki 页无入链（排除 index/log/overview/sources 首层） |
| `missing_frontmatter` | error | 缺 title/date/type |
| `type_dir_mismatch` | error | type 与目录不匹配 |
| `log_format_invalid` | error | log 条目格式不符 |
| `log_date_decreasing` | error | 日期非递增 |
| `protected_page_modified` | warning | overview/log 结构异常 |

**type↔目录映射**:
- `entities/` → `entity`
- `concepts/` → `concept`
- `sources/` → `source`
- `synthesis/` → `synthesis`
- `comparisons/` → `comparison`
- `queries/` → `query`

### Decision 3: 入口暴露

```
CLI:  llmwiki lint [dir] [--json]
HTTP: GET /api/v1/lint
MCP:  search tool mode="lint" (或 guide 中说明)
```

Web UI 首版：Settings 或 WarningPopover 展示 lint 摘要（可选 task，非阻塞）。

### Decision 4: 模块位置

- `internal/engine/lint.go` — 核心逻辑
- `internal/engine/log_validator.go` — log 契约
- `internal/engine/frontmatter.go` — 新增 `ValidateFrontmatter(path, fm)`
- `cmd/llmwiki/lint.go` — CLI
- `internal/api/lint.go` — HTTP handler

## Risks

| 风险 | 缓解 |
|------|------|
| orphan 误报（故意独立页） | warning 级别；可配置 exclude |
| 性能（大 wiki walk） | 首版全量 scan；后续增量 |
