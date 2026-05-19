## 1. 全局导航重构

- [x] 1.1 修改 App.tsx 的 View 类型，从 `"ingest" | "wiki" | "settings"` 扩展为 `"ingest" | "jobs" | "wiki" | "settings"`
- [x] 1.2 在 App.tsx 的 TabsList 中新增 Jobs Tab 触发器（位于 Ingest Hub 和 Wiki 之间）
- [x] 1.3 新增 TabsContent for "jobs" view，渲染占位组件
- [x] 1.4 验证导航在 4 个 Tab 之间正常切换

## 2. 依赖警告 Popover

- [x] 2.1 创建 `WarningPopover` 组件：接收 `missingDeps: RuntimeDependency[]`，仅在数组非空时渲染警告图标
- [x] 2.2 使用 `@base-ui/react` Popover 实现 hover 触发，展示缺失依赖列表（名称 + 用途）
- [x] 2.3 将 WarningPopover 集成到 App.tsx 的 Ingest Hub TabsTrigger 旁（作为图标内嵌或相邻元素）
- [x] 2.4 确保无缺失依赖时图标完全隐藏

## 3. 沉浸式对话摄入区

- [x] 3.1 重写 `IngestHub.tsx` 布局：移除三列 grid 和 Runtime Dependencies Card，改为居中大面板（`max-w-2xl mx-auto`）
- [x] 3.2 实现空状态占位提示"粘贴对话内容开始摄入..."，内容输入后自动消失
- [x] 3.3 实现 textarea 自适应高度（min-h-40, max-h-[60vh]），监听 input 事件动态调整高度
- [x] 3.4 实现折叠式"高级选项"区域：会话标题和来源输入框，默认收起，点击展开
- [x] 3.5 实现操作栏：主按钮"提交摄入" + 次按钮"上传文件" + 次按钮"文本"
- [x] 3.6 实现提交后反馈：按钮旁显示 ✓ 成功提示，1.5 秒后淡出，清空输入区

## 4. 粘贴反馈展示

- [x] 4.1 创建 `PastePreview` 组件：接收粘贴内容，计算行数和字符数
- [x] 4.2 实现格式检测逻辑：Markdown（`^#` 标题）、对话格式（`^\w+:` 模式提取对话人）、SRT 字幕（`^\d+\n\d{2}:\d{2}`）
- [x] 4.3 在 IngestHub 的 textarea 上方集成 PastePreview，监听 `onPaste` 事件触发，手动输入时不显示
- [x] 4.4 样式处理：摘要条使用淡色背景（`bg-muted`），不干扰 textarea 编辑

## 5. 文本摄入模态框

- [x] 5.1 创建 `TextIngestDialog` 组件：使用 `@base-ui/react` Dialog 实现模态框
- [x] 5.2 模态框内容：标题输入框、文件名输入框、大 textarea（min-h-48）、取消/提交按钮
- [x] 5.3 提交逻辑：调用 `submitText` API，成功后关闭模态框并刷新 jobs
- [x] 5.4 关闭逻辑：支持点击遮罩层和 ✕ 按钮关闭，不保存内容
- [x] 5.5 在 IngestHub 操作栏中集成"文本"按钮，点击打开 TextIngestDialog

## 6. 文件上传按钮化

- [x] 6.1 在 IngestHub 操作栏中实现"上传文件"按钮，点击触发隐藏 `<input type="file" multiple>` 的 click
- [x] 6.2 上传完成后在操作栏下方 inline 显示结果（accepted 数量、rejected 详情）
- [x] 6.3 上传期间按钮显示 loading 状态（disabled + spinner）

## 7. 拖放文件上传

- [x] 7.1 在对话输入区监听 `onDragOver` / `onDragLeave` / `onDrop` 事件
- [x] 7.2 实现拖入视觉反馈：边框变为蓝色虚线高亮
- [x] 7.3 释放文件时调用 `submitUpload` API，复用文件上传的结果展示逻辑

## 8. Jobs 独立页面

- [x] 8.1 创建 `JobsPage.tsx` 组件：独立的全局页面，包含状态筛选栏和任务列表
- [x] 8.2 创建 `StatusFilter` 组件：Tab 形式展示 All / Queued / Running / Succeeded / Failed，从 ingestJobs 聚合计数显示 badge
- [x] 8.3 实现客户端状态筛选：选中 Tab 时过滤 ingestJobs 数组，无需 API 调用
- [x] 8.4 实现空状态："暂无摄入任务"提示
- [x] 8.5 将 JobsPage 集成到 App.tsx 的 "jobs" TabsContent 中

## 9. Job 卡片列表

- [x] 9.1 创建 `JobCard` 组件：展示 source_path、input_type、created_at、状态标签（语义颜色）
- [x] 9.2 失败任务展示：inline 显示 error_message 和 remediation
- [x] 9.3 操作按钮：failed 状态显示 Retry 按钮，queued/running 状态显示 Cancel 按钮
- [x] 9.4 在 JobsPage 中使用 JobCard 渲染过滤后的任务列表

## 10. 清理与验证

- [x] 10.1 删除 IngestHub.tsx 中已废弃的代码（旧三列布局、旧 Jobs 列表、旧 Runtime Dependencies Card）
- [x] 10.2 验证所有 4 个全局 Tab 正常切换，Ingest Hub 和 Jobs 页面独立工作
- [x] 10.3 验证响应式布局：大屏居中、小屏全宽，TabsList 在窄屏可滚动
- [x] 10.4 更新 `ingest.test.tsx` 测试以匹配新的组件结构
