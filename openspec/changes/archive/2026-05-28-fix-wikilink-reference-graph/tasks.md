## 1. 核心解析逻辑

- [x] 1.1 在 `internal/engine/references.go` 中添加 `wikiDoubleBracketRe` 正则常量（与 `lint.go` 一致：`\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]`）
- [x] 1.2 在 `parseWikiLinks` 函数中增加 `wikiDoubleBracketRe` 匹配分支：提取目标路径，去掉 `|display` 别名部分，调用 `resolveWikiPath` 解析为 docID，产出 `links_to` 边

## 2. 单元测试

- [x] 2.1 测试 `[[attention]]` 基本解析（目标存在于 docsByWikiPath）
- [x] 2.2 测试 `[[concepts/attention]]` 带路径解析
- [x] 2.3 测试 `[[concepts/attention|Display Text]]` 带别名解析（忽略显示文本）
- [x] 2.4 测试 `[[nonexistent]]` 目标不存在时不创建边
- [x] 2.5 测试 `[[transformers]]` 无扩展名时自动追加 `.md` 解析
- [x] 2.6 测试同一内容中 `[text](href)` 和 `[[wikilink]]` 混合使用时两种语法都能产出边

## 3. 集成验证

- [x] 3.1 运行 `go test ./internal/engine/...` 确保所有引用解析测试通过
- [x] 3.2 运行 `go test ./internal/api/...` 确保图谱 API 测试通过
- [x] 3.3 手动验收：在测试 workspace 中创建含 `[[wikilink]]` 的页面，运行 reindex，验证 `GET /api/v1/graph` 返回对应的 edges
