## Context

LLM 生成的 wiki 页面中使用 Obsidian 风格的 `[[wikilink]]` 语法。LLM 倾向于用 title 风格作为链接目标（如 `[[Adam Foroughi]]`），而文件系统中对应的路径是 `entities/adam-foroughi.md`（slug 风格，连字符分隔）。

当前的 wikilink 解析策略（前端 `remark-wikilink.ts` 和后端 `references.go` 的 `resolveWikiPath`）各提供三步解析：精确匹配 → 追加 `.md` → 基名匹配。三步都缺少空格与连字符的归一化。后端虽然构建了 `docsByFilename`（含 title→id）和 `docsByBase`（basename→id）索引，但 `resolveWikiPath` 并没有使用这些索引。

此外，图谱页面 (`GraphPage`) 的节点点击处理通过 `navigateTo()` 仅修改 URL，而 `WikiReaderProvider` 的 URL 同步 effect 依赖 `[publicWikiEnabled, documents, currentDocId, selectDocument]`，不监听 URL 变化，导致文档不会加载。

## Goals / Non-Goals

**Goals:**

- 让 `[[Adam Foroughi]]` 这类使用 title/空格风格的 wikilink 能正确解析到 `entities/adam-foroughi.md`
- 前后端的 wikilink 解析策略保持一致
- 图谱节点点击后能正确打开对应文档页面
- 保持对现有能正确解析的 wikilink 的兼容性

**Non-Goals:**

- 不修改 LLM 的 prompt 或生成策略（LLM 用 title 风格是合理的，解析层应兼容）
- 不修改 URL 同步 effect 的依赖机制（采用更直接的修复方式）
- 不增加新的 API 端点或数据库字段

## Decisions

### Decision 1: 归一化策略 — slugify 后再匹配

**选择**: 在 `resolveWikiPath` 的每一步匹配之前，对查询 key 做 slug 归一化（空格→连字符、连续连字符合并），同时对索引也构建 slug 版本用于匹配。

**替代方案**:
- A. 仅对查询做归一化，遍历索引逐条比较 → O(n) 扫描，性能差
- B. 构建一个 slugified → id 的额外索引 → 一次性构建，O(1) 查找

**选择 B**: 构建额外的 slug 索引。前端在 `buildWikiPathIndex` 中同时构建 `slugIndex: Map<string, string>`；后端在 `NewReferenceParser` 中增加 `docsBySlug: map[string]string`。

slugify 函数规则：
```
1. 转小写
2. 空格 → 连字符
3. 连续连字符 → 单个连字符
4. 去掉首尾连字符
```

归一化查找插入在现有的三步策略中：

```
Strategy 1: 精确匹配          (不变)
Strategy 2: 追加 .md          (不变)  
Strategy 3: 基名匹配          (不变)
Strategy 4: slug 归一化匹配    (新增)
Strategy 5: title 索引匹配    (新增，前端/后端各有不同实现)
```

Strategy 4 对所有已失败的查询执行 slugify 后，在 slug 索引中查找。Strategy 5 在前端使用 title→id 映射，在后端使用已有的 `docsByFilename` 索引。

### Decision 2: 图谱点击修复 — 直接调用 selectDocument

**选择**: `GraphPage` 通过 `useWikiReader()` 获取 `selectDocument`，节点点击时直接调用它。

**替代方案**:
- A. 让 `WikiReaderProvider` 监听 URL 变化 → 需要引入新的 subscription 机制，复杂度高
- B. 用 `useEffect` 在 layout 层检测 pathname/doc 参数变化 → 时序脆弱

**选择直接调用**: `selectDocument` 已经封装了「加载文档 + 更新 URL + 设置 state」的完整流程。侧边栏也是这么做的。保持一致。

### Decision 3: 前端 title 索引构建

**选择**: 在前端 `buildWikiPathIndex` 中额外构建 `titleToId: Map<string, string>`，映射小写 title → doc id。

**理由**: `DocumentListItem` 类型包含 `title` 字段。后端的 `docsByFilename` 已经在做 title 索引了。前端补齐后，即使 slug 归一化也匹配不到，title 仍然能兜底。

## Risks / Trade-offs

- **[归一化过度匹配]** → slugify 可能将不同的 title 归一化为同一个 slug（如 "A-B" 和 "A B"）。缓解：归一化仅作为 fallback 策略（Strategy 4），精确匹配优先。
- **[title 重复]** → 多个文档可能有相同 title。缓解：title 索引用 `if _, exists := map[k]; !exists` 的 first-write-wins 策略，与后端 `docsByFilename` 行为一致。
- **[索引构建性能]** → 额外构建 slug 索引和 title 索引增加 O(n) 的初始化开销。缓解：文档列表通常 < 10K，Map 构建在毫秒级。
- **[GraphPage 重渲染]** → `selectDocument` 作为 context 方法被 memoized，不会导致额外重渲染。
