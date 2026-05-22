## Context

`WikiMentionPicker.tsx` 是 @ 触发的 wiki 页面搜索组件。用户在 textarea 中输入 `@` 时弹出搜索面板，选择后构建 `WikiRefPayload`（含 `document_id`、`relative_path`、`title`）传给 `IngestChat`，随消息一起发送到后端。

后端 `ParseWikiRefRequests`（`chat_wiki_executor.go:22-46`）收到 `wiki_refs` 后，通过 `db.GetWikiDocumentByID` 从数据库查询文档，比对前端传来的 `relative_path` 与数据库中的 `doc.RelativePath`，不一致则报错。

`MessageBubble` 组件（`IngestChat.tsx:46-201`）中的 action bar 在气泡 div 外部，使用 `h-0` + `overflow-visible` 实现不占空间但 hover 可见。当前 CSS 导致图标与气泡底部视觉重叠。

## Goals / Non-Goals

**Goals:**

- 修复 relative_path 字段映射错误，@ 引用的消息能正常发送
- action bar 图标完全可见，不被气泡遮挡
- @ 面板支持 ArrowUp / ArrowDown / Enter 键盘导航

**Non-Goals:**

- 不改变后端校验逻辑
- 不重构组件架构
- 不新增 i18n 键

## Decisions

### Decision 1: relative_path 修复

**根因**：`WikiMentionPicker.tsx:159` 使用 `doc.path` 而非 `doc.relative_path`。

后端 `Document` 结构有两个字段：
- `path`：目录路径，如 `"wiki"`
- `relative_path`：完整相对路径，如 `"wiki/xxx.md"`

后端校验逻辑（`chat_wiki_executor.go:36`）：
```go
if rp := strings.TrimSpace(ref.RelativePath); rp != "" && rp != doc.RelativePath {
    return nil, fmt.Errorf("relative_path mismatch for document %s", ref.DocumentID)
}
```

前端发送 `"wiki"`，数据库中存的是 `"wiki/xxx.md"`，不匹配。

**修复**：`addRef` 函数中将 `relative_path: doc.path` 改为 `relative_path: doc.relative_path`。

注意：`DocumentListItem.relative_path` 是 optional（`relative_path?: string`），但后端 `ListDocumentsFiltered` 查询中使用了 `COALESCE(relative_path, '')`，Go JSON 序列化会输出空字符串 `""`，前端收到的总是有值（可能为 `""`）。对于 wiki 文档，`relative_path` 总是非空的。

### Decision 2: action bar 布局修复

**当前代码**（`IngestChat.tsx:171`）：
```tsx
<div className="flex h-0 items-center gap-1 overflow-visible px-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
```

**问题分析**：
- `h-0` 使容器高度为 0
- `pt-1`（4px）不足以让图标（size-3.5 = 14px）完全脱离气泡底边
- `overflow-visible` 让图标溢出显示，但视觉上与气泡圆角重叠

**修复方案**：移除 `h-0`，改用 `mt-0.5` 的自然间距：

```tsx
<div className="flex items-center gap-1 px-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
```

这样容器有自然高度，图标在气泡下方有 2px 间距，不会被遮挡。

### Decision 3: 键盘导航实现

**状态管理**：
```tsx
const [highlightIndex, setHighlightIndex] = useState(0)
```

**键盘事件处理**：在现有 Escape 监听基础上扩展（或新增 textarea 级别的 keydown 监听）：

```
面板关闭时：highlightIndex 不生效，不拦截任何按键

面板打开时（keydown 拦截）：
  ArrowDown → highlightIndex = min(i+1, results.length-1), e.preventDefault()
  ArrowUp   → highlightIndex = max(i-1, 0), e.preventDefault()
  Enter     → addRef(results[highlightIndex]), e.preventDefault()
  Escape    → 关闭面板（已有逻辑）
  其他键    → 不拦截，正常输入到 textarea
```

**为什么在 textarea 上监听而非 document**：当前 Escape 监听在 `document` 上。ArrowUp/Down 需要在 textarea 上拦截以阻止光标移动。最佳方案是将键盘监听统一到 textarea 的 `onKeyDown` prop 上（通过回调暴露），或通过 `useEffect` 在 textarea ref 上添加 `keydown` listener。

由于 `WikiMentionPicker` 已持有 `textareaRef`，最简单的方案是新增一个 `useEffect` 监听 textarea 的 `keydown` 事件（仅在面板打开时）。

**高亮样式**：当前选中项添加 `bg-accent` 类：

```tsx
<Button
  className={`... ${idx === highlightIndex ? 'bg-accent' : ''}`}
>
```

**搜索词变化时重置 index**：每次 `searchQuery` 变化时，`highlightIndex` 重置为 0。

**边界条件**：
- `results` 为空时不处理 Arrow/Enter
- `highlightIndex` 不超出 `results` 范围
- 选择后面板关闭，`highlightIndex` 重置

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| `relative_path` 可能为空字符串 | 后端 `strings.TrimSpace(ref.RelativePath)` 为空时跳过校验（`rp != ""` 条件），空值不会触发 mismatch 错误；但 wiki 文档的 relative_path 总是非空 |
| action bar 布局修改可能影响消息间距 | 移除 `h-0` 后容器有自然高度（约 20px），只在 hover 时可见，不影响非 hover 状态的布局紧凑性 |
| textarea keydown 拦截可能干扰 IME 输入 | 仅在面板打开时拦截 ArrowUp/Down/Enter，不拦截字符输入；IME composing 期间通常不产生这些按键 |
| 高亮 index 与滚动不同步 | `results` 列表最多 8 项（已有 `fuzzySearchDocs` 的 limit），面板 `max-h-48` 足以容纳所有结果，无需 scroll-into-view |

## Migration Plan

无数据库或 API 变更。纯前端修复，直接修改两个文件：
1. `WikiMentionPicker.tsx`：修复 relative_path + 添加键盘导航
2. `IngestChat.tsx`：修复 action bar 布局
