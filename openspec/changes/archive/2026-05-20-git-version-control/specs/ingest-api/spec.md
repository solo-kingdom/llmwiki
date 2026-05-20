## ADDED Requirements

### Requirement: Rollback job 创建端点
系统 SHALL 提供 HTTP API 用于创建 rollback job。

#### Scenario: 创建 rollback job
- **WHEN** 客户端发送 `POST /api/v1/ingest/rollback` 请求，body 包含 `commit_sha`
- **THEN** 系统 SHALL 验证 commit SHA 有效且为 ingest 类型 commit
- **AND** 创建 `input_type = 'rollback'` 的 job，`source_ref` 存储 commit SHA
- **AND** 返回创建的 job 信息

#### Scenario: 无效 commit SHA
- **WHEN** 请求的 commit SHA 不存在
- **THEN** 系统 SHALL 返回 404 错误

#### Scenario: Rollback commit 不可回滚
- **WHEN** 目标 commit 是 rollback 类型（非 ingest 产生）
- **THEN** 系统 SHALL 返回 400 错误，提示该 commit 不支持回滚

#### Scenario: 版本控制未启用
- **WHEN** workspace 未启用版本控制
- **THEN** 系统 SHALL 返回 400 错误，提示需先启用版本控制
