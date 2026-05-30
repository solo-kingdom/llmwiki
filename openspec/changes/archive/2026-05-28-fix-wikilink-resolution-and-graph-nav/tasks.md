## 1. 前端 wikilink 解析增强

- [x] 1.1 在 `web/src/lib/remark-wikilink.ts` 中实现 `slugify(str: string): string` 工具函数：小写 → 空格转连字符 → 合并连续连字符 → 去首尾连字符
- [x] 1.2 在 `buildWikiPathIndex` 中额外构建 `slugIndex: Map<string, string>`（对 index 的 key 做 slugify 映射到 doc id）和 `titleToId: Map<string, string>`（小写 title → doc id）
- [x] 1.3 在 `resolveWikiPath` 中追加 Strategy 4（slug 归一化匹配）和 Strategy 5（title 索引匹配），在现有三步策略全部失败后执行
- [x] 1.4 更新 `createRemarkWikiLink` 工厂函数，将 `slugIndex` 和 `titleToId` 传入 `visitTextNodes`/`splitByWikilinks` 链路

## 2. 后端 wikilink 解析增强

- [x] 2.1 在 `internal/engine/references.go` 的 `NewReferenceParser` 中构建 `docsBySlug map[string]string`（对 `docsByWikiPath` 的 key 做 slugify 后映射到 doc id）
- [x] 2.2 在 `resolveWikiPath` 中追加 Strategy 4（slug 归一化匹配：对 resolvedLower 做 slugify 后在 `docsBySlug` 中查找）
- [x] 2.3 在 `resolveWikiPath` 中追加 Strategy 5（在 `docsByFilename` 和 `docsByBase` 中查找 resolvedLower），利用已有索引
- [x] 2.4 实现 Go 版本的 `slugify` 函数（与前端保持一致：小写 → 空格转连字符 → 合并连续连字符 → 去首尾连字符）

## 3. 图谱节点点击修复

- [x] 3.1 在 `GraphPage.tsx` 中通过 `useWikiReader()` 获取 `selectDocument` 方法
- [x] 3.2 修改 `handleNodeClick` 回调：调用 `selectDocument(node.document_id)` 替代 `navigateTo(wikiReaderHref(...))`
- [x] 3.3 更新 `handleNodeClick` 的 `useCallback` 依赖数组为 `[selectDocument]`
- [x] 3.4 移除 `GraphPage.tsx` 中不再需要的 `navigateTo` 和 `wikiReaderHref` 导入

## 4. 测试

- [x] 4.1 前端测试：在 `remark-wikilink.test.ts` 中增加 slug 归一化匹配场景（空格→连字符 wikilink 解析）
- [x] 4.2 前端测试：增加 title 索引兜底匹配场景（title 存在但路径不匹配时通过 title 解析）
- [x] 4.3 前端测试：增加多空格归一化场景（连续空格→单个连字符）
- [x] 4.4 后端测试：在 `references_test.go` 中增加 `[[Adam Foroughi]]` → `adam-foroughi.md` 的 slug 归一化解析场景
- [x] 4.5 后端测试：增加 title 索引兜底匹配场景
- [x] 4.6 图谱测试：更新 `graph-page.test.tsx` 验证节点点击调用 `selectDocument` 而非 `navigateTo`
- [x] 4.7 运行完整测试套件 `make test` 确认无回归
