## Why

Chat 页面存在三个 Bug 影响基本可用性：

1. **发送带 @ 引用的消息报错**：用户在聊天中使用 `@` 选择 wiki 页面后发送消息，后端返回 `{"error":"relative_path mismatch for document xxx"}`。原因是前端 `WikiMentionPicker` 构建 `WikiRefPayload` 时使用了 `doc.path`（如 `"wiki"`）而非 `doc.relative_path`（如 `"wiki/xxx.md"`），与后端 `ParseWikiRefRequests` 的校验逻辑不匹配。这是阻断性 Bug——所有带 @ 引用的消息发送都会失败。

2. **消息气泡下方图标被遮挡**：action bar（复制、排除归档按钮）使用了 `h-0` + `overflow-visible` 的技巧来避免占用空间，但 `pt-1` 的 padding 不足以让图标脱离气泡底部的视觉范围，导致图标被气泡圆角/边框部分遮挡。hover 时用户难以看清或点击这些按钮。

3. **@ 面板不支持键盘导航**：`WikiMentionPicker` 弹出的文件选择面板只支持鼠标点击选择，完全没有 ArrowUp / ArrowDown / Enter 的键盘导航支持。这不符合用户对下拉选择器的交互预期，且降低了选择效率。

## What Changes

三个独立修复，互不依赖：

### Bug 1: relative_path 字段错误

- `WikiMentionPicker.tsx` 中 `addRef` 函数：将 `doc.path` 改为 `doc.relative_path`

### Bug 2: action bar 图标被遮挡

- `IngestChat.tsx` 中 `MessageBubble` 的 action bar 容器：移除 `h-0`，使用自然的 flex 布局或适当的 margin/padding 确保图标完全可见且不被气泡遮挡

### Bug 3: @ 面板键盘导航

- `WikiMentionPicker.tsx` 新增 `highlightIndex` 状态
- 监听 textarea 的 `keydown` 事件（面板打开时），拦截 ArrowUp / ArrowDown / Enter
- ArrowUp/Down 修改 `highlightIndex`（clamp 到 0 ~ results.length - 1）
- Enter 触发选中项的 `addRef`
- 面板中高亮当前选中项（bg-accent 样式）
- 拦截期间需要 `e.preventDefault()` 阻止 textarea 光标移动

## Capabilities

### Modified Capabilities

- `wiki-mention`：修复 relative_path 字段；新增键盘导航

## Impact

- **Frontend only**：修改 `WikiMentionPicker.tsx` 和 `IngestChat.tsx`，无需后端变更
- **无 breaking change**

## Non-Goals

- 不重构 WikiMentionPicker 的整体架构
- 不改变后端校验逻辑（后端逻辑是正确的）
- 不增加 Tab 键导航或其他高级交互
