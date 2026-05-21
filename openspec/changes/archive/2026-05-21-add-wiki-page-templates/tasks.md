## 1. 模板内容

- [x] 1.1 定义 6 类页面中文模板常量（`internal/engine/templates.go` 或 scaffold 包）
- [x] 1.2 entity: 概述、关键事实、相关概念、来源
- [x] 1.3 concept: 定义、核心要点、相关实体、来源
- [x] 1.4 source: 摘要、关键观点、相关实体/概念
- [x] 1.5 synthesis: 问题/目的、分析、引用、后续
- [x] 1.6 comparison: 对比维度、异同、结论
- [x] 1.7 query: 问题、回答、引用

## 2. Init 集成

- [x] 2.1 init 创建 `wiki/templates/` 并写入 6 文件（writeIfNotExists）
- [x] 2.2 已初始化 workspace repair 补全 templates

## 3. Pipeline Prompt

- [x] 3.1 抽取 `templateGuidanceForGeneration(docLang)` 函数
- [x] 3.2 注入 `generate()` systemMsg
- [x] 3.3 pipeline 测试：断言 prompt 含 section 要求

## 4. 测试与验收

- [x] 4.1 init 测试：templates 目录与文件存在
- [ ] 4.2 手工验收：ingest 产出页面含预期 section 标题
- [x] 4.3 运行 `go test ./internal/ingest/... ./cmd/llmwiki/...`
