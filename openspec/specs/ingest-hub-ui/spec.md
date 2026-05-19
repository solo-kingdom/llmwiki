## REMOVED Requirements

### Requirement: 沉浸式对话摄入区
**Reason**: 主交互由单 textarea「提交摄入」改为聊天会话 + 归档，见 `ingest-chat-ui`。
**Migration**: 使用 Ingest 页消息流与 **归档** 按钮；长文粘贴作为用户消息发送。

### Requirement: 粘贴反馈展示
**Reason**: 粘贴摘要条绑定旧 textarea 模型，聊天模式下不再作为主交互。
**Migration**: 粘贴内容直接进入 composer，可选在发送前显示字符统计（非必须）。

### Requirement: 文本摄入模态框
**Reason**: 文本直投收敛为聊天消息内容，避免双入口。
**Migration**: 在 composer 输入或粘贴长文后发送；批量结构化导入仍可通过附件上传。

## MODIFIED Requirements

### Requirement: 文件上传按钮
Ingest 页 composer 区域 SHALL 提供附件上传能力；上传结果通过会话附件 API 与助手摘要消息呈现，而非仅 inline 统计条。

#### Scenario: 点击上传按钮
- **WHEN** 用户点击 composer 附件按钮
- **THEN** 系统 SHALL 触发文件选择器（支持多选）并上传到当前会话

#### Scenario: 上传结果展示
- **WHEN** 附件上传完成
- **THEN** UI SHALL 在消息流中展示附件理解结果或失败说明（含 accepted/rejected 语义）

### Requirement: 依赖警告 Popover
Ingest 导航标签旁 SHALL 在存在缺失运行时依赖时显示警告图标，hover 触发 Popover 展示详情。

#### Scenario: 无缺失依赖
- **WHEN** 所有运行时依赖均已安装
- **THEN** Ingest Tab 旁 SHALL NOT 显示警告图标

#### Scenario: 有缺失依赖时显示图标
- **WHEN** 存在未安装的运行时依赖
- **THEN** Ingest Tab 标签旁 SHALL 显示警告图标

#### Scenario: Hover 展示依赖详情
- **WHEN** 用户 hover 警告图标
- **THEN** 系统 SHALL 显示 Popover，列出缺失依赖名称与用途

### Requirement: 拖放文件上传
composer 区域 SHALL 支持拖放文件，拖入时显示视觉反馈，释放后触发会话附件上传。

#### Scenario: 拖入文件视觉反馈
- **WHEN** 用户将文件拖入 composer 区域
- **THEN** 边框 SHALL 高亮提示可释放

#### Scenario: 释放文件触发上传
- **WHEN** 用户在 composer 区域释放文件
- **THEN** 系统 SHALL 调用会话附件 API 并更新消息流
