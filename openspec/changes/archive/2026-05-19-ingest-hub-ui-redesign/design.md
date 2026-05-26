## Context

当前 IngestHub 组件（`web/src/components/IngestHub.tsx`）将对话摄入、文本提交、文件上传以等权三列 Card 并列，Jobs 列表嵌入底部。整体视觉粗糙，核心功能缺乏聚焦。

技术栈已具备：
- `@base-ui/react` 提供 Popover / Dialog 原语
- `lucide-react` 提供图标
- `shadcn` 提供基础 UI 组件（Button、Input、Card、Tabs、Badge）
- `AppContext` 已提供全部所需 API（`submitConversation`、`submitText`、`submitUpload`、`ingestJobs`、`capabilities`）

此次变更为纯前端重构，无后端 API 变更。

## Goals / Non-Goals

**Goals:**
- 将对话摄入确立为 Ingest Hub 页面的视觉核心，采用沉浸式居中大面板设计
- 将 Jobs 管理提升为独立全局 Tab，配备状态筛选
- Runtime Dependencies 警告从独立 Card 改为 Popover，减少视觉噪音
- 文本摄入从 Card 降级为模态框，文件上传从 Card 降级为按钮
- 提供丰富的粘贴反馈（行数、字符数、格式检测）
- 支持拖放文件到对话输入区

**Non-Goals:**
- 不改变后端 API 接口
- 不改变数据模型（IngestJob 类型保持不变）
- 不实现实时 WebSocket 推送（保持 3 秒轮询）
- 不做暗色主题专项适配（沿用现有 CSS 变量体系）
- 不做国际化（保持中文 UI）

## Decisions

### 1. 全局导航结构：4 Tab 替代 3 Tab

**决策**：App.tsx 的 `View` 类型从 `"ingest" | "wiki" | "settings"` 扩展为 `"ingest" | "jobs" | "wiki" | "settings"`。

**理由**：Jobs 列表当前嵌入 IngestHub 底部，与摄入操作混在一起，既分散摄入区的注意力，又限制了 Jobs 展示空间。提升为全局 Tab 后：
- 摄入页面可以专注做沉浸式输入
- Jobs 页面有充足空间做状态筛选和详情展示

**替代方案**：在 Ingest Hub 内做二级 Tab（摄入 / Jobs），但这样增加了层级深度，且 Jobs 的状态筛选变成三级 Tab，过于复杂。

### 2. 沉浸式摄入区：居中大面板 + 自适应高度

**决策**：对话输入区使用 `max-w-2xl mx-auto` 居中，textarea 使用 `auto-grow` 模式（min-h-40, max-h-[60vh]），内容为空时显示居中占位提示。

**理由**：类 ChatGPT 输入体验，用户注意力自然聚焦到输入区。居中布局在大屏上留白自然，在小屏上自动全宽。

**实现细节**：
- 空状态显示大字提示"粘贴对话内容开始摄入..."
- 粘贴/输入后，提示消失，textarea 动态增高
- 底部操作栏固定：`[提交摄入 ▶] [📎 上传文件] [📝 文本]`
- 标题和来源输入折叠在"高级选项"按钮下，默认收起

### 3. 警告 Popover：标题旁图标 + hover 触发

**决策**：使用 `@base-ui/react` 的 Popover 组件，在 Ingest Hub Tab 标签旁放置 ⚠ 图标（仅在有缺失依赖时显示），hover 触发弹出。

**理由**：
- 不占用页面空间
- hover 比 click 更轻量，适合信息展示型内容
- `@base-ui/react` 已安装，无需新增依赖

**替代方案**：使用 shadcn 的 Tooltip 组件。但 Tooltip 不适合多行内容展示，Popover 更合适。

### 4. 粘贴反馈：多维度信息展示

**决策**：textarea 上方显示粘贴摘要条，包含行数、字符数、格式检测信息。

**实现逻辑**：
- 监听 `onPaste` 事件捕获粘贴动作
- 从粘贴内容计算行数、字符数
- 简单正则检测内容格式：Markdown 标题（`^#`）、对话格式（`^\w+:`）、SRT 字幕（`^\d+\n\d{2}:\d{2}`）
- 如果检测到对话格式，额外显示对话人数量
- 摘要条使用淡色背景，不干扰编辑

**替代方案**：在 textarea 外做预览面板。但这样增加了复杂度，且用户需要切换编辑/预览模式。直接在 textarea 上方显示摘要更轻量。

### 5. 文本摄入模态框

**决策**：使用 `@base-ui/react` 的 Dialog 组件创建模态框，包含标题输入、文件名输入、大 textarea。

**理由**：文本摄入是次要操作，但需要充足编辑空间。模态框提供隔离的编辑环境，不干扰主页面。

### 6. 文件上传按钮化

**决策**：按钮点击触发隐藏 `<input type="file">` 的 click 事件，上传结果 inline 显示在操作栏下方。

**理由**：最简方案，不需要额外面板。拖放作为补充入口。

### 7. Jobs 状态筛选：Tab + 计数 Badge

**决策**：Jobs 页面顶部使用 Tab 组件展示状态筛选（All / Queued / Running / Succeeded / Failed），每个 Tab 显示对应数量。

**实现逻辑**：
- 从 `ingestJobs` 数组中按 `job.status` 聚合计数
- 选中 Tab 时客户端过滤（无需 API 调用）
- 3 秒轮询刷新时计数自动更新

### 8. 拖放支持

**决策**：在对话输入区监听 `onDragOver` / `onDrop` 事件，拖入时显示视觉反馈（边框高亮），释放时触发文件上传。

**理由**：零额外 UI 成本，复用已有 `submitUpload` 流程。

## Risks / Trade-offs

- **[textarea auto-grow 性能]** → 使用 CSS `field-sizing: content`（现代浏览器支持）或 JS 计算高度时 debounce。目标浏览器均可支持。
- **[粘贴检测误判]** → 格式检测使用简单正则，可能误判。缓解：检测结果仅作信息展示，不影响功能逻辑，用户可忽略。
- **[Jobs 轮询频率不变]** → 3 秒轮询可能造成 Jobs 页面状态延迟。缓解：计数 badge 在 running job 存在时提供视觉锚点，用户可接受短暂延迟。
- **[4 Tab 导航在小屏拥挤]** → 可能在移动端溢出。缓解：使用 TabsList 的 `overflow-x-auto` 样式，允许横向滚动。
