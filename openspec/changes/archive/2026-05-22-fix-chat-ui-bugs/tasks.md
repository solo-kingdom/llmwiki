## 1. Bug 1 — 修复 relative_path 字段映射

- [x] 1.1 `WikiMentionPicker.tsx` `addRef` 函数：将 `relative_path: doc.path` 改为 `relative_path: doc.relative_path`
- [x] 1.2 验证：选择 wiki 页面后发送消息，不再报 `relative_path mismatch` 错误

## 2. Bug 2 — 修复 action bar 图标被遮挡

- [x] 2.1 `IngestChat.tsx` `MessageBubble` action bar 容器：移除 `h-0`，改为自然 flex 布局（`flex items-center gap-1 px-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100`）
- [x] 2.2 验证：hover 消息气泡时，复制和排除归档图标完全可见，不被气泡边框遮挡

## 3. Bug 3 — @ 面板键盘导航

- [x] 3.1 `WikiMentionPicker.tsx` 新增 `highlightIndex` 状态（初始值 0）
- [x] 3.2 新增 `useEffect`：当面板打开时，在 `textareaRef.current` 上添加 `keydown` 事件监听
  - `ArrowDown`：`highlightIndex = min(i+1, results.length-1)`，`e.preventDefault()`
  - `ArrowUp`：`highlightIndex = max(i-1, 0)`，`e.preventDefault()`
  - `Enter`：如果 `results.length > 0`，调用 `addRef(results[highlightIndex])`，`e.preventDefault()`
  - 仅在面板打开（`open === true`）时拦截
- [x] 3.3 搜索结果列表项添加高亮样式：当前 `highlightIndex` 对应的项添加 `bg-accent` 类
- [x] 3.4 `searchQuery` 变化时重置 `highlightIndex` 为 0
- [x] 3.5 面板关闭时重置 `highlightIndex` 为 0
- [x] 3.6 验证：@ 面板打开后，上下键可切换高亮，Enter 可选择高亮项

## 4. 收尾

- [x] 4.1 运行 `npm test`（web）确保前端测试通过
- [x] 4.2 更新 `ingest-chat.test.tsx`：确认 wiki_refs 测试用例中 `relative_path` 字段使用正确值
- [x] 4.3 手动验证三个 Bug 均已修复
