## Why

当前 Web 端主要承担浏览与设置功能，缺少统一、可操作的数据摄入入口，导致“导入数据→触发处理→查看状态→验证结果”无法在同一主流程完成。随着用户希望直接在 Web 中进行对话式摄入、文本提交与文件上传，现有交互与 API 能力已无法支撑核心使用路径。

## What Changes

- 将 Web 重构为“默认摄入入口”，在首屏提供 Ingest Hub，而非仅文档浏览。
- 新增三种统一摄入方式：
  - 对话式摄入（基于会话生成 ingest draft/job）
  - 文本提交摄入（直接提交文本/Markdown）
  - 文件上传摄入（单文件/批量文件）
- 新增摄入任务模型与状态流：`queued` / `running` / `succeeded` / `failed` / `cancelled`。
- 新增 Web 所需 ingest API（创建任务、查询任务、查看失败原因、重试）。
- 将摄入能力与运行时处理能力（如 PDF/Office 依赖可用性）联动展示，提供可观测降级提示。
- 明确格式处理策略：文本、图片、PDF、Office、压缩包按能力分层处理，无法提取时返回结构化失败原因与修复建议。

## Capabilities

### New Capabilities
- `ingest-api`: 定义面向 Web 默认入口的摄入任务 API、状态模型与错误语义。

### Modified Capabilities
- `web-ui`: 将 Web 入口从“浏览优先”扩展为“摄入优先”，新增 Ingest Hub 与三类摄入交互。
- `ingest-pipeline`: 将现有管线能力暴露为可调度任务模型，补充多输入类型与可观测状态要求。
- `workspace-management`: 明确 Web 摄入与工作区文件真理边界（原始文件落盘、索引重建一致性）。

## Impact

- 前端：`web/src/App.tsx` 导航结构、摄入页面与任务状态组件、API SDK 扩展。
- 服务端：新增 ingest API 路由与处理器，补充任务持久化与状态查询接口。
- 引擎/处理：扩展输入适配层（会话文本、上传文件、压缩包展开策略）并与现有 source processing tier 对齐。
- 可观测性：新增 ingest 任务日志、失败分类、依赖缺失提示。
- 兼容性：现有文档浏览与搜索功能保留，但信息架构与默认入口将发生变化。
