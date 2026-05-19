## 1. 样式基础设施

- [ ] 1.1 在 `App.css` 中新增 `--header-bg` CSS 变量：light 模式 `oklch(0.98 0.012 80)`，dark 模式 `oklch(0.22 0.012 80)`
- [ ] 1.2 在 `App.css` 的 `@theme inline` 块中注册 `--color-header-bg` 为 `var(--header-bg)`，使其可在 Tailwind class 中使用

## 2. Header 居中悬浮样式

- [ ] 2.1 重写 `App.tsx` 中 header 区域：外层 `div` 使用 `flex justify-center pt-3 px-4`，内层使用 `inline-flex items-center gap-4 rounded-xl shadow-sm bg-header-bg px-5 py-2.5`，去掉原有 `border-b`
- [ ] 2.2 将 "LLMWiki" 标题和 TabsList 放入内层悬浮容器中，确认整体居中且宽度自适应内容
- [ ] 2.3 验证 dark 模式下 header 悬浮效果正常（暖色背景、阴影可见）

## 3. SearchBar 移入 Sidebar

- [ ] 3.1 修改 `Sidebar.tsx`：将 SearchBar 组件移入 Sidebar 顶部区域，替代原有 "Documents" 标题，保留文件计数显示
- [ ] 3.2 修改 `SearchBar.tsx`：将外层容器从 `w-72` 改为 `w-full`，弹出层定位从 `right-0` 改为 `left-0`，宽度设为 `min-w-full`
- [ ] 3.3 修改 `DocumentViewer.tsx`：移除两处 `<SearchBar />` 引用（空状态第45行、有文档标题栏第87行），标题栏从 `justify-between` 简化为纯纵向布局
- [ ] 3.4 处理 DocumentViewer 空状态：移除 SearchBar 后重新组织空状态提示页面的布局

## 4. 验证

- [ ] 4.1 验证所有四个 tab（Ingest、Jobs、Wiki、Settings）切换正常，header 悬浮样式一致
- [ ] 4.2 验证 Wiki tab：搜索在 sidebar 顶部可用，输入关键词后弹出层在下方展开，点击结果后文档打开且弹出层关闭
- [ ] 4.3 验证非 Wiki tab：搜索栏不可见
- [ ] 4.4 验证 light/dark 模式切换后 header 和 sidebar 样式均正常
