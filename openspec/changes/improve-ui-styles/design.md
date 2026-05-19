## Context

当前 Web UI header 使用朴素的 `border-b` + `flex items-center` 布局，紧贴顶部、直角、无阴影，缺乏视觉层次。Wiki tab 的 SearchBar 嵌入在 DocumentViewer 组件的文档标题栏右侧（`justify-between` 布局），搜索功能作为全局操作却被局限在文档级视图中，且与标题、元信息、标签等元素拥挤在一行。

技术栈：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui（基于 @base-ui/react）。样式使用 oklch 色彩空间，支持 light/dark 主题。

## Goals / Non-Goals

**Goals:**
- Header 视觉升级：居中悬浮、圆角、阴影、暖色背景，有层次感
- SearchBar 归位到 Sidebar 顶部，搜索只在 Wiki tab 可见
- 暗色模式下同样美观

**Non-Goals:**
- 不改变 header 的 tab 结构和导航逻辑
- 不改变搜索功能的业务逻辑（API 调用、结果处理等）
- 不引入新的 UI 组件库或依赖
- 不做响应式/移动端适配（当前是桌面应用）

## Decisions

### Decision 1: Header 使用 CSS 变量控制暖色背景

**选择**：在 `App.css` 中定义 `--header-bg` 变量，通过 oklch 定义暖色调。

**Light**: `oklch(0.98 0.012 80)` — 淡奶油暖白，与纯白背景 `oklch(1 0 0)` 有微妙区分
**Dark**: `oklch(0.22 0.012 80)` — 对应的暗色暖调

**替代方案**：
- 直接硬编码 Tailwind class → 不利于 dark mode 切换，且主题一致性差
- 使用 accent color → 过于强烈，header 应该是中性偏暖而非强调色

### Decision 2: Header 布局结构

**选择**：外层 `flex justify-center pt-3 px-4`，内层 `inline-flex items-center gap-4 rounded-xl shadow-sm bg-[var(--header-bg)] px-5 py-2.5`

```
┌─ bg-background ──────────────────────────────────┐
│               pt-3 px-4                           │
│     ┌── rounded-xl shadow-sm bg-header ──┐       │
│     │ LLMWiki   [TabsList]               │       │
│     └────────────────────────────────────┘       │
│                                                   │
│   content (flex-1)                                │
└───────────────────────────────────────────────────┘
```

关键：`w-fit mx-auto` 使 header 宽度自适应内容，不撑满屏幕。

### Decision 3: SearchBar 移入 Sidebar 顶部

**选择**：SearchBar 组件从 DocumentViewer 中移除，改为 Sidebar 顶部第一个子元素。

```
Sidebar 新布局:
┌──────────────────┐
│ 🔍 [Search...]    │  ← SearchBar, w-full
│   42 files        │  ← 保留文件计数
│──────────────────│
│ 文件树...         │
└──────────────────┘
```

搜索结果弹出层改为 `left-0` 定位（向下展开），宽度 `min-w-full` 覆盖 sidebar 宽度。

**替代方案**：
- 放 header 内全局可见 → 搜索只在 wiki 有意义，放 header 会误导其他 tab 用户
- 放 DocumentViewer 独立工具条 → 会挤占文档内容空间

### Decision 4: DocumentViewer 标题栏简化

**选择**：移除 SearchBar 引用，标题栏从 `flex justify-between` 改为纯纵向布局，只保留标题、元信息、标签。

## Risks / Trade-offs

- **[搜索结果在 sidebar 内弹出可能遮挡文件树]** → 可接受：搜索时用户注意力在搜索结果上，点击结果后弹出层自动关闭
- **[暖色背景在不同显示器上色差]** → oklch 色彩空间感知均匀，比 hsl 更稳定
- **[Header 悬浮后内容区域可用高度减少约 12px]** → 影响 微乎其微，桌面应用有充足空间
