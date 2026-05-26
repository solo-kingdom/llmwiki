## Why

当前 Web UI 的 header 使用 `border-b` 直角边框、无阴影、左对齐布局，视觉上过于朴素，缺乏层次感。同时 Wiki tab 的 SearchBar 嵌入在 DocumentViewer 的文档标题栏右侧，搜索是全局操作却被当作文档级附属功能，且与标题信息拥挤在一起，交互体验差。需要通过视觉重构提升整体质感。

## What Changes

- **Header 改为居中悬浮样式**：去掉 `border-b` 边框，改为 `rounded-xl` 圆角 + `shadow-sm` 阴影 + 暖色背景，通过 `mx-auto` + `mt-3 mx-4` 实现居中悬浮效果
- **SearchBar 从 DocumentViewer 移到 Sidebar 顶部**：搜索只在 Wiki tab 可见，放在 Sidebar 文件树上方，宽度填满 sidebar，搜索结果在输入框下方展开
- **DocumentViewer 标题栏简化**：移除 SearchBar 后，标题栏不再需要 `justify-between` 布局

## Capabilities

### New Capabilities

_(无新能力引入)_

### Modified Capabilities

- `web-ui`: 全局 header 布局从左对齐贴顶边框样式改为居中悬浮暖色圆角阴影样式；Wiki tab 搜索功能从 DocumentViewer 内部移至 Sidebar 顶部

## Impact

- **前端组件**：`App.tsx`（header 区域重写）、`Sidebar.tsx`（顶部改为 SearchBar）、`DocumentViewer.tsx`（移除 SearchBar 引用、简化标题栏）
- **样式**：`App.css`（新增 header 暖色背景 CSS 变量，light/dark 两套）
- **SearchBar.tsx`**：弹出层定位方向调整（从 `right-0` 改为 `left-0`，适配 sidebar 宽度）
- **无后端影响**：纯前端样式变更，不涉及 API 或数据层
