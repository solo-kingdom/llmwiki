## 1. 核心 Lint 引擎

- [ ] 1.1 定义 `LintIssue`, `LintReport`, `LintStats` 类型（`internal/engine/lint.go`）
- [ ] 1.2 实现 wiki 页面 walk 与 wikilink 解析收集
- [ ] 1.3 实现死链检测（解析 `[[link]]` + markdown links，检查目标存在）
- [ ] 1.4 实现孤立页检测（利用引用图或反向链接，排除导航页）
- [ ] 1.5 实现 Wiki 统计（页数、源数、最后更新日期）

## 2. Frontmatter 验证

- [ ] 2.1 扩展 `frontmatter.go`：解析 `type` 字段
- [ ] 2.2 新增 `ValidateFrontmatter(relPath, fm)` — 必需字段 + type↔目录
- [ ] 2.3 集成到 lint 引擎

## 3. Log 契约验证

- [ ] 3.1 新增 `internal/engine/log_validator.go`
- [ ] 3.2 验证条目前缀：`## [YYYY-MM-DD] action | description`
- [ ] 3.3 验证日期非递减
- [ ] 3.4 单元测试：合法/非法 log 样例

## 4. CLI

- [ ] 4.1 新增 `cmd/llmwiki/lint.go`
- [ ] 4.2 支持 `--json` 输出
- [ ] 4.3 exit code：有 error 级 issue 时 exit 1

## 5. HTTP API

- [ ] 5.1 新增 `internal/api/lint.go` + 路由注册
- [ ] 5.2 `GET /api/v1/lint` 返回 JSON LintReport
- [ ] 5.3 API 测试

## 6. MCP

- [ ] 6.1 `search` tool 增加 `mode="lint"`
- [ ] 6.2 MCP router 测试

## 7. Web UI（可选最小集成）

- [ ] 7.1 Settings 或 WarningPopover 展示 lint error/warning 计数（可选）
- [ ] 7.2 i18n 中文 lint 摘要文案

## 8. 测试与验收

- [ ] 8.1 `lint_test.go`：fixture mini-wiki 覆盖各检查项
- [ ] 8.2 手工验收：CLI + HTTP + MCP 三入口结果一致
- [ ] 8.3 运行 `go test ./internal/engine/... ./cmd/llmwiki/... ./internal/api/...`
