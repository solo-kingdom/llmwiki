## 1. 后端 index 生成修复

- [ ] 1.1 在 `IndexBuilder.buildIndexContent()` 中为 wikilink 的 display 分隔符及表格单元格内的 `|` 添加 `\|` 转义辅助函数
- [ ] 1.2 更新 `index_builder_test.go`：断言生成的 wikilink 为 `[[entities/alpha\|Alpha Entity]]` 且每行四列
- [ ] 1.3 补充测试：title 或 description 含 `|` 时单元格正确转义且列数不变

## 2. 前端 wikilink 渲染

- [ ] 2.1 更新 `remark-wikilink.ts` 正则与 display 提取逻辑，支持 GFM 表格中转义后的 `\|` 分隔符
- [ ] 2.2 在 `remark-wikilink.test.ts` 增加 `[[entities/alpha\|Alpha Entity]]` 解析用例
- [ ] 2.3 在 `MarkdownContent.test.tsx` 或 wiki reader 测试中增加 index 表格样例：验证四列渲染、链接可点击、无裸露 `[[`/`]]`

## 3. 验证与迁移

- [ ] 3.1 运行 `go test ./internal/engine/...` 与 `npm test`（相关测试文件）确保通过
- [ ] 3.2 本地 workspace 执行 `llmwiki reindex`，确认 `wiki/index.md` 实体/概念/源摘要表格显示正常
