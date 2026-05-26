## Why

当前 Ingest Hub 界面将对话摄入、文本提交、文件上传三个功能以等权三列 Card 并列展示，导致核心功能（对话摄入）缺乏视觉聚焦，操作效率低下。Runtime Dependencies 警告占据独立 Card 位置突兀，Ingest Jobs 列表混在摄入操作下方缺少状态筛选。整体视觉粗糙，不符合"对话摄入是核心入口"的产品定位。

## What Changes

- **全局导航扩展**：从 3 个 Tab（Ingest / Wiki / Settings）扩展为 4 个 Tab（Ingest Hub / Jobs / Wiki / Settings），将 Ingest Jobs 从嵌入卡片提升为独立全局页面
- **沉浸式对话摄入区**：对话输入占据页面核心位置，居中大面板设计，支持粘贴检测与丰富预览（行数、字符数、格式检测、对话人识别）
- **依赖警告 Popover**：将 Runtime Dependencies Card 替换为 Ingest Hub 标题旁的警告图标 + Popover（hover 展示缺失依赖详情）
- **次要操作按钮化**：文本提交和文件上传从独立 Card 降级为操作栏按钮——"文本"按钮触发模态框（内含长文本编辑器），"上传文件"按钮直接触发系统文件选择器
- **Jobs 状态筛选 Tab**：在 Jobs 全局页面顶部添加状态筛选 Tab（All / Queued / Running / Succeeded / Failed），每个 Tab 显示对应数量 badge
- **拖放支持**：对话摄入区支持拖放文件自动触发上传流程
- **提交反馈优化**：提交后在按钮旁显示成功状态反馈，无需页面跳转

## Capabilities

### New Capabilities
- `ingest-hub-ui`: 沉浸式摄入界面——对话输入为核心、粘贴预览、警告 Popover、文件上传按钮、文本摄入模态框、拖放支持
- `jobs-page-ui`: 独立的 Ingest Jobs 管理页面——状态筛选 Tab、数量 badge、Job 卡片列表、展开详情

### Modified Capabilities
- `web-ui`: 全局导航从 3 Tab 扩展为 4 Tab（新增 Jobs 视图），移除原 IngestHub 组件中的 Jobs 列表和三列布局

## Impact

- **前端组件**：重写 `IngestHub.tsx`，新建 `JobsPage.tsx`、`TextIngestDialog.tsx`、`WarningPopover.tsx`、`StatusFilter.tsx`、`PastePreview.tsx` 等组件
- **App.tsx**：View 类型从 3 值扩展为 4 值，新增 Jobs Tab 触发
- **无后端变更**：所有 API 接口保持不变（`/api/v1/ingest/jobs/*`、`/api/v1/capabilities`），纯前端重构
- **新增依赖**：可能需要 `@base-ui/react` 的 Popover/Dialog 组件（已安装）或 shadcn 的 dialog/popover 组件
- **AppContext**：无需变更，现有 `ingestJobs`、`capabilities`、`submitConversation`、`submitText`、`submitUpload` 等接口完全复用
