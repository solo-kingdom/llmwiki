## ADDED Requirements

### Requirement: Job 源文件预览
系统 SHALL 提供 job 关联源文件的预览功能，支持用户在模态框中查看原始文件内容。

#### Scenario: 预览 markdown 文件
- **WHEN** 用户点击 job 卡片中可点击的 `source_path`，且文件后缀为 `.md` 或 `.txt`
- **THEN** 系统 SHALL 调用源文件 API 获取内容，在模态框中使用 ReactMarkdown 渲染展示

#### Scenario: 预览图片文件
- **WHEN** 用户点击 job 卡片中可点击的 `source_path`，且文件后缀为 `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.svg`
- **THEN** 系统 SHALL 在模态框中直接展示图片

#### Scenario: 不支持的文件格式
- **WHEN** job 的 `source_path` 后缀不属于支持的预览格式
- **THEN** `source_path` SHALL 保持纯文本展示，不可点击

#### Scenario: 预览模态框布局
- **WHEN** 预览模态框打开
- **THEN** 模态框 SHALL 使用 `max-w-3xl` 宽度，内容区域使用 `max-height` 限制高度并支持滚动

#### Scenario: 文件不存在
- **WHEN** 预览请求返回 404（源文件已被删除）
- **THEN** 模态框 SHALL 显示"文件未找到"的错误提示

#### Scenario: 关闭预览
- **WHEN** 用户点击模态框关闭按钮或点击背景遮罩
- **THEN** 模态框 SHALL 关闭，回到 job 列表
