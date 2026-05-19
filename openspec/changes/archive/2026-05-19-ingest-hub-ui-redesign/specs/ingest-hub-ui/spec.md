## ADDED Requirements

### Requirement: 沉浸式对话摄入区
Ingest Hub 页面 SHALL 以居中大面板形式展示对话输入区作为页面视觉核心，占据页面主要空间。文本和文件摄入入口 SHALL 以按钮形式排列在操作栏中。

#### Scenario: 空状态显示
- **WHEN** 用户打开 Ingest Hub 页面且输入区为空
- **THEN** 页面 SHALL 显示居中占位提示"粘贴对话内容开始摄入..."，textarea 处于待输入状态

#### Scenario: 对话输入居中展示
- **WHEN** 用户在输入区输入或粘贴内容
- **THEN** 输入区 SHALL 以 `max-w-2xl mx-auto` 居中显示，textarea 自适应高度（min-h-40, max-h-60vh）

#### Scenario: 提交对话摄入
- **WHEN** 用户输入内容后点击"提交摄入"按钮
- **THEN** 系统 SHALL 调用 `submitConversation` API，成功后清空输入区并在按钮旁显示成功反馈

#### Scenario: 高级选项折叠
- **WHEN** 用户点击"高级选项"按钮
- **THEN** 系统 SHALL 展开/折叠"会话标题"和"来源"输入框（默认折叠）

### Requirement: 粘贴反馈展示
对话输入区 SHALL 在用户粘贴内容后显示多维度信息摘要条，包括行数、字符数和格式检测结果。

#### Scenario: 粘贴内容摘要
- **WHEN** 用户粘贴内容到 textarea
- **THEN** textarea 上方 SHALL 显示摘要条，包含行数和字符数（如"Pasted · 12 lines · 1,847 chars"）

#### Scenario: 格式检测
- **WHEN** 用户粘贴的内容包含可识别格式
- **THEN** 摘要条 SHALL 显示格式标签（如"Markdown detected"、"3 speakers detected"）

#### Scenario: 手动输入无摘要
- **WHEN** 用户通过键盘手动输入内容（非粘贴）
- **THEN** 摘要条 SHALL NOT 显示，textarea 正常使用

### Requirement: 文件上传按钮
Ingest Hub 操作栏 SHALL 提供"上传文件"按钮，点击触发系统文件选择器，上传结果 inline 展示。

#### Scenario: 点击上传按钮
- **WHEN** 用户点击"上传文件"按钮
- **THEN** 系统 SHALL 触发浏览器文件选择器（支持多选）

#### Scenario: 上传结果展示
- **WHEN** 文件上传完成
- **THEN** 操作栏下方 SHALL inline 显示上传结果（accepted/rejected 数量及详情）

### Requirement: 文本摄入模态框
Ingest Hub 操作栏 SHALL 提供"文本"按钮，点击后打开模态框，内含标题、文件名和长文本编辑区。

#### Scenario: 打开文本摄入模态框
- **WHEN** 用户点击"文本"按钮
- **THEN** 系统 SHALL 显示模态框，包含标题输入框、文件名输入框和大 textarea 编辑区

#### Scenario: 提交文本摄入
- **WHEN** 用户在模态框中输入内容并点击"提交文本摄入"
- **THEN** 系统 SHALL 调用 `submitText` API，成功后关闭模态框

#### Scenario: 取消文本摄入
- **WHEN** 用户点击模态框的关闭按钮或遮罩层
- **THEN** 模态框 SHALL 关闭，不保存已输入内容

### Requirement: 依赖警告 Popover
Ingest Hub 导航标签旁 SHALL 在存在缺失运行时依赖时显示警告图标，hover 触发 Popover 展示详情。

#### Scenario: 无缺失依赖
- **WHEN** 所有运行时依赖均已安装（`capabilities.runtime_dependencies` 全部 `found: true`）
- **THEN** 导航标签旁 SHALL NOT 显示警告图标

#### Scenario: 有缺失依赖时显示图标
- **WHEN** 存在未安装的运行时依赖
- **THEN** Ingest Hub Tab 标签旁 SHALL 显示 ⚠ 警告图标

#### Scenario: Hover 展示依赖详情
- **WHEN** 用户 hover 警告图标
- **THEN** 系统 SHALL 显示 Popover，列出所有缺失依赖的名称和用途说明

### Requirement: 拖放文件上传
对话输入区 SHALL 支持拖放文件，拖入时显示视觉反馈，释放后自动触发文件上传流程。

#### Scenario: 拖入文件视觉反馈
- **WHEN** 用户将文件拖入对话输入区
- **THEN** 输入区边框 SHALL 高亮显示（如变为蓝色虚线边框），提示可释放

#### Scenario: 释放文件触发上传
- **WHEN** 用户在对话输入区释放拖入的文件
- **THEN** 系统 SHALL 使用 `submitUpload` API 上传文件，结果 inline 展示
