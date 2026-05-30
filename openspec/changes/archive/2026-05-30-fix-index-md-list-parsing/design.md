## Context

`IndexBuilder.buildIndexContent()` 为每个 wiki 页面生成 GFM 表格行：

```markdown
| [[entities/alpha|Alpha Entity]] | Alpha Entity | First entity | 2024-03-01 |
```

GFM 表格解析器按未转义的 `|` 分列。wikilink 显示文本分隔符 `|` 与列分隔符冲突，导致一行被拆成 5+ 段。典型症状：

- 「页面」列出现 `[[entities/Adam_Foroughi Adam Foroughi]]`（pipe 被吃掉，wikilink 语法裸露）
- 同一标题在相邻列重复显示
- 「摘要」「更新日期」列空白或内容错位

前端 `remark-wikilink` 插件在单元格文本已被破坏时无法正确转换 wikilink。

## Goals / Non-Goals

**Goals:**

- 生成的 `wiki/index.md` 每行严格四列，wikilink 在 Web UI 中可点击
- 前端正确渲染 GFM 转义 pipe 的 wikilink（`[[target\|display]]`）
- 后端与前端测试覆盖含 pipe 的 wikilink 表格行

**Non-Goals:**

- 改变 index 表格列结构（仍为：页面、标题、摘要、更新日期）
- 为 index.md 引入专用 React 组件替代通用 Markdown 渲染
- 修改 Obsidian 导出格式或非 index 页面的 wikilink 约定

## Decisions

### 1. 后端：在 index 表格 wikilink 中转义 `|`

在 `IndexBuilder` 写入表格前，将 wikilink 内的 `|` 替换为 GFM 转义序列 `\|`：

```go
link := fmt.Sprintf("[[%s/%s\\|%s]]", e.Subdir, e.Slug, e.Title)
```

**理由**: GFM 规范支持 `\|` 在表格单元格内表示字面 pipe，是改动最小、与现有 Markdown 管线兼容的方案。

**备选方案**:

| 方案 | 弃用原因 |
|------|----------|
| 改用 `[[target display]]` 空格语法 | 非 Obsidian 标准，后端 lint/引用解析需同步改 |
| 去掉「页面」列 wikilink，仅保留标题列 | 损失可点击导航，不符合 Karpathy index 设计 |
| HTML `<a>` 替代 wikilink | 破坏纯 Markdown 可读性，MCP/CLI 体验不一致 |

### 2. 前端：扩展 wikilink 正则识别 `\|`

`remark-wikilink.ts` 的 `WIKILINK_RE` 与 display text 提取逻辑需接受 `\|` 作为 display 分隔符，解析时将 `\|` 规范化为 `|` 用于显示。

**理由**: remark-gfm 解析表格后会将 `\|` 还原为 `|` 传入 text 节点；若 AST 中仍保留反斜杠，正则需兼容两种形式。

### 3. 不增加 index 专用渲染路径

继续通过 `MarkdownContent` + `remarkGfm` + `remarkWikiLink` 渲染 index.md。

**理由**: 根因是源 Markdown 格式错误，修复生成端即可；专用组件增加维护成本。

## Risks / Trade-offs

- **[Risk] 表格单元格内其他 `|` 字符（如摘要含 pipe）也会破坏列结构** → 在 `IndexBuilder` 中对 title、description、date 字段同样做 `\|` 转义（若字段含 `|`）
- **[Risk] 旧 workspace 未 reindex 前仍显示异常** → 文档与 release note 提示运行 `llmwiki reindex`；Migration Plan 见下
- **[Risk] remark-gfm 版本差异对 `\|` 处理不一致** → 用集成测试固定 index 样例 markdown 的渲染输出

## Migration Plan

1. 合并代码后，用户（或 CI）对现有 workspace 执行 `llmwiki reindex`
2. `WriteIndex()` 覆写 `wiki/index.md`，无需手动编辑
3. 回滚：还原代码后再次 reindex 即可恢复旧格式（但旧格式仍有显示 bug）

## Open Questions

（无）
