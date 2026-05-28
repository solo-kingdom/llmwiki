## Context

当前 wiki 页面中的 `[[link]]` 双括号语法在以下流程中存在问题：

- **后端**：`internal/engine/references.go` 的 `ReferenceParser` 已正确解析 `[[target]]` 和 `[[target|display]]`，用于知识图谱和 lint，解析逻辑使用 `resolveWikiPath()` 通过三步策略（精确匹配 → 追加 `.md` → 基名匹配）将 wiki 路径映射到文档 ID
- **前端**：`DocumentViewer.tsx` 使用 `react-markdown` 配合 `remark-gfm` 和 `rehype-highlight` 渲染 markdown，但没有处理 `[[wikilink]]` 语法的插件，导致原样显示为纯文本
- **已有基础设施**：`WikiReaderContext` 已加载完整的文档列表（包含 `id`、`filename`、`title`、`path`），`DocumentViewer` 已有 `/d/{id}` 链接的点击拦截逻辑

## Goals / Non-Goals

**Goals:**
- 将 `[[target]]` 和 `[[target|显示文本]]` 转换为可点击的 HTML 链接
- 利用已加载的文档列表在前端解析 wiki 路径到文档 ID
- 与现有 DocumentViewer 点击导航无缝集成
- 对无法解析的链接提供视觉区分
- 在所有使用 MarkdownContent 的组件中生效

**Non-Goals:**
- 不修改后端代码（后端已正确处理）
- 不新增 npm 依赖
- 不实现 `[[page#section]]` 锚点跳转（后端 regex 也不支持）
- 不处理嵌套链接语法

## Decisions

### 1. 使用自定义 remark 插件而非 rehype 插件

**选择**：创建自定义 remark 插件 `remarkWikiLink`

**理由**：
- remark 阶段操作的是 markdown AST，可以直接将 `[[text]]` 文本节点转换为 link 节点
- rehype 阶段操作 HTML AST，此时文本已被分割，处理更复杂
- 与现有 `remark-gfm` 插件并行工作，架构一致

**替代方案**：使用 `remark-wiki-link` npm 包 → 引入外部依赖，且其 API 设计与我们的路径解析需求不完全匹配

### 2. 前端路径解析策略

**选择**：在前端复刻后端 `resolveWikiPath()` 的三步策略

**理由**：
- 文档列表已在 `WikiReaderContext` 中加载，无需额外 API 调用
- 解析逻辑简单（精确匹配 → 追加 `.md` → 基名匹配）
- 避免渲染时触发网络请求导致闪烁

**实现**：将文档列表传入 remark 插件配置，插件内部构建与后端 `docsByWikiPath` 等价的映射表

### 3. 链接输出格式

**选择**：转换为 `[text](/d/{docId})` 标准 markdown 链接

**理由**：
- 与现有 DocumentViewer 的点击拦截逻辑 (`href.startsWith("/d/")`) 完全兼容
- 无需修改现有事件处理代码
- 对于 MarkdownContent（非 WikiReader 上下文），链接表现为普通的相对路径

### 4. 断链处理

**选择**：为无法解析的链接添加 CSS class `wikilink-broken`

**理由**：
- 视觉上区分有效链接和断链，与 wiki lint 功能呼应
- 不隐藏断链，用户仍能看到原始文本
- 通过 CSS 类而非内联样式，方便自定义

### 5. 插件集成方式

**选择**：通过组件 props 传入文档列表，由 remark 插件工厂函数创建配置好的插件实例

**理由**：
- remark 插件是静态配置，不能直接访问 React context
- 通过工厂模式 `createRemarkWikiLink(documents)` 返回配置好的插件
- DocumentViewer 从 `useWikiReader()` 获取文档列表，传入工厂函数

## Risks / Trade-offs

- **[文档列表更新延迟]** → 如果新增文档但前端文档列表未刷新，wikilink 可能暂时显示为断链。缓解：用户刷新页面即可；这与现有导航行为一致
- **[路径解析一致性]** → 前端解析逻辑可能与后端略有差异（如大小写处理）。缓解：严格复刻后端的 `resolveWikiPath` 逻辑，包括 `strings.ToLower` 处理
- **[性能]** → 每次渲染都构建映射表。缓解：使用 `useMemo` 缓存插件实例，文档列表不变时不重建
