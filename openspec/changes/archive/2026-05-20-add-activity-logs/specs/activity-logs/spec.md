## ADDED Requirements

### Requirement: 活动日志数据模型
系统 SHALL 在 SQLite 中维护 `activity_logs` 表，用于持久化结构化系统操作记录。该表 SHALL 归类为 OPERATIONAL 数据：不可从文件系统重建，workspace reindex 流程 SHALL NOT 删除或重建此表数据。

#### Scenario: 表结构
- **WHEN** 数据库 schema 初始化或迁移
- **THEN** `activity_logs` 表 SHALL 包含字段：`id`、`created_at`、`level`、`category`、`action`、`message`、`resource_type`、`resource_id`、`status`、`details`（JSON 字符串）、`source`
- **AND** `level` SHALL 限制为 `debug`、`info`、`warn`、`error`
- **AND** `category` SHALL 支持 `ingest`、`document`、`vcs`、`provider`、`session`、`system`、`mcp`、`watcher`

#### Scenario: Reindex 保留日志
- **WHEN** 用户执行 workspace reindex
- **THEN** `activity_logs` 表中已有记录 SHALL 保持不变

### Requirement: 异步日志写入
系统 SHALL 提供统一的活动日志写入 API（`internal/activity`），供各模块非阻塞地记录事件。

#### Scenario: 非阻塞写入
- **WHEN** 业务模块调用日志写入
- **THEN** 写入 SHALL 异步执行，SHALL NOT 阻塞 ingest pipeline、HTTP handler 或 watcher 主路径

#### Scenario: 写入失败降级
- **WHEN** 异步写入数据库失败
- **THEN** 系统 SHALL 输出 stdout warning，SHALL NOT 使调用方业务操作失败

#### Scenario: 敏感信息过滤
- **WHEN** 记录 provider 或认证相关操作
- **THEN** 日志 message 和 details SHALL NOT 包含 API key 或 Authorization 凭证

### Requirement: Ingest 事件记录
系统 SHALL 记录 ingest job 生命周期事件到活动日志。

#### Scenario: Job 状态变迁
- **WHEN** ingest job 进入 queued、running、succeeded、failed、cancelled 状态，或被 retry
- **THEN** 系统 SHALL 写入 `category=ingest` 日志，包含 job id、source_path、status 及 error 信息（如有）

### Requirement: Document 事件记录
系统 SHALL 记录文档 CRUD 操作（HTTP API 与 MCP tools）。

#### Scenario: 文档创建
- **WHEN** 通过 API 或 MCP 创建文档
- **THEN** 系统 SHALL 写入 `category=document, action=created` 日志，包含文档 id 或 relative_path

#### Scenario: 文档更新与删除
- **WHEN** 通过 API 或 MCP 更新、删除或批量删除文档
- **THEN** 系统 SHALL 写入对应 `updated`、`deleted` 或 `bulk_deleted` 日志

### Requirement: VCS 事件记录
系统 SHALL 记录版本控制相关操作。

#### Scenario: 版本控制启停
- **WHEN** 用户启用或禁用版本控制
- **THEN** 系统 SHALL 写入 `category=vcs, action=init` 或 `disable` 日志

#### Scenario: Rollback 操作
- **WHEN** 用户触发 rollback 或 rollback job 完成/失败
- **THEN** 系统 SHALL 写入 rollback 开始、成功或失败日志，包含 commit SHA（如有）

### Requirement: Provider 事件记录
系统 SHALL 记录 Provider instance 配置变更。

#### Scenario: Instance CRUD
- **WHEN** 用户创建、更新或删除 provider instance
- **THEN** 系统 SHALL 写入 `category=provider` 日志，包含 instance id 和 name，不含 api_key

### Requirement: Session 事件记录
系统 SHALL 记录 ingest session 归档与 stream 错误。

#### Scenario: Session archive
- **WHEN** session archive 开始、成功或失败
- **THEN** 系统 SHALL 写入 `category=session` 日志，包含 session id 和失败原因（如有）

#### Scenario: Stream error
- **WHEN** ingest session LLM stream 发生 error、incomplete 或 client 初始化失败
- **THEN** 系统 SHALL 写入 `category=session, action=stream_error, level=error` 日志

### Requirement: System 事件记录
系统 SHALL 记录系统级运维事件。

#### Scenario: Reindex
- **WHEN** reindex 开始或完成
- **THEN** 系统 SHALL 写入 `category=system` 汇总日志，包含索引文件数量；失败文件 SHALL 单独记 `watcher/index_failed` 或 system 级 error

#### Scenario: Models sync 与服务启动
- **WHEN** models.dev 同步失败或服务进程启动
- **THEN** 系统 SHALL 写入对应 `models_sync_failed` 或 `server_started` 日志（level 按严重程度）

### Requirement: MCP 事件记录
系统 SHALL 记录 MCP tool 调用摘要。

#### Scenario: Tool 调用
- **WHEN** MCP client 调用任意 tool
- **THEN** 系统 SHALL 写入 `category=mcp, action=tool_called` 日志，包含 tool 名称；SHALL NOT 记录完整 tool 参数中的敏感字段

### Requirement: Watcher 文件变更记录
系统 SHALL 记录文件 watcher 检测到的 workspace 文件变更。

#### Scenario: 文件创建与删除
- **WHEN** watcher 检测到文件 create 或 delete（非 ignore 路径）
- **THEN** 系统 SHALL 写入 `category=watcher, action=file_created` 或 `file_deleted` 日志，包含 relative_path

#### Scenario: 文件修改 debounce 合并
- **WHEN** 同一 relative_path 在 700ms 窗口内触发多次 modify
- **THEN** 系统 SHALL 合并为一条 `action=file_modified` 日志

#### Scenario: 索引失败
- **WHEN** watcher 或 indexer 对某文件索引失败
- **THEN** 系统 SHALL 写入 `category=watcher, action=index_failed, level=error` 日志，包含 path 和 error

### Requirement: 活动日志查询 API
系统 SHALL 提供 `GET /api/v1/logs` 供管理工作台查询活动日志。

#### Scenario: 分页列表
- **WHEN** 客户端请求 `GET /api/v1/logs?limit=50&offset=0`
- **THEN** 系统 SHALL 按 `created_at` 降序返回日志条目数组及总数（或 has_more 指示）

#### Scenario: 类别与级别筛选
- **WHEN** 客户端请求带 `category` 或 `level` 查询参数
- **THEN** 系统 SHALL 仅返回匹配的记录

#### Scenario: 管理 API 鉴权
- **WHEN** 服务配置了 management token
- **THEN** logs API SHALL 受与其他 `/api/v1` 管理端点相同的 token 鉴权保护

### Requirement: 清空全部日志 API
系统 SHALL 提供 `DELETE /api/v1/logs` 清空所有活动日志。

#### Scenario: 清空成功
- **WHEN** 客户端发送 `DELETE /api/v1/logs`
- **THEN** 系统 SHALL 删除 `activity_logs` 表中全部记录
- **AND** 响应 SHALL 包含 `deleted_count`
- **AND** 系统 SHALL 写入一条 `category=system, action=logs_cleared` 日志（作为清空后唯一或首条记录）

#### Scenario: 空表清空
- **WHEN** 日志表已为空时执行清空
- **THEN** 系统 SHALL 返回 `deleted_count=0` 且不报错

### Requirement: 日志最大保留条数配置
系统 SHALL 在 Settings 中提供活动日志最大保留条数配置，持久化于 `app_config`。

#### Scenario: 配置项存储
- **WHEN** 用户保存 Settings
- **THEN** `activity_logs_max_count` SHALL 写入 `app_config` 表
- **AND** 默认值 SHALL 为 `10000`
- **AND** 允许范围 SHALL 为 `100`–`100000`

#### Scenario: 读取配置
- **WHEN** 客户端请求 `GET /api/v1/settings`
- **THEN** 响应 SHALL 包含 `activity_logs_max_count` 字段

#### Scenario: 非法值拒绝
- **WHEN** 客户端提交超出允许范围的 `activity_logs_max_count`
- **THEN** 系统 SHALL 返回 400 错误或不接受该字段更新

### Requirement: 超出上限自动清理
系统 SHALL 定期检查活动日志总数，并在超过配置上限时删除最旧记录。

#### Scenario: 定期清理
- **WHEN** 服务进程运行中
- **THEN** 系统 SHALL 每隔固定间隔（5 分钟）检查 `activity_logs` 总数
- **AND** 若总数大于 `activity_logs_max_count`，SHALL 按 `created_at` 升序删除最旧记录，直至总数不超过上限

#### Scenario: 设置变更后立即清理
- **WHEN** 用户通过 Settings 更新 `activity_logs_max_count` 且当前总数已超过新上限
- **THEN** 系统 SHALL 立即执行一次 trim，无需等待下次定期检查

#### Scenario: 清理留痕
- **WHEN** 自动 trim 删除了至少一条记录
- **THEN** 系统 SHALL 写入 `category=system, action=logs_trimmed` 日志
- **AND** details SHALL 包含 `deleted_count`、`max_count`、`remaining_count`

#### Scenario: 未超限不清理
- **WHEN** 当前日志总数小于或等于 `activity_logs_max_count`
- **THEN** 定期检查 SHALL NOT 删除任何记录
- **AND** SHALL NOT 写入 `logs_trimmed` 日志
