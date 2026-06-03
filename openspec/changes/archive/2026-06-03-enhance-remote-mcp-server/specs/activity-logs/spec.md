## MODIFIED Requirements

### Requirement: MCP 事件记录
系统 SHALL 记录 MCP tool 调用摘要，覆盖本地与远程 MCP client 调用，并 SHALL 对认证、header、token 和完整参数内容做敏感信息过滤。

#### Scenario: Tool 调用
- **WHEN** MCP client 调用任意 tool
- **THEN** 系统 SHALL 写入 `category=mcp, action=tool_called` 日志，包含 tool 名称；SHALL NOT 记录完整 tool 参数中的敏感字段

#### Scenario: 远程 Tool 调用成功
- **WHEN** 远程 MCP client 成功调用 tool
- **THEN** 系统 SHALL 写入 `category=mcp` 日志，包含 tool 名称、调用来源摘要、耗时、状态 `success` 和可用的 agent/client 标识
- **AND** 日志 SHALL NOT 包含 Authorization header、Bearer token、完整请求 body 或完整 tool 返回内容

#### Scenario: 远程 Tool 调用失败
- **WHEN** 远程 MCP tool 调用因参数错误、策略拒绝或执行错误失败
- **THEN** 系统 SHALL 写入 `category=mcp` 日志，包含 tool 名称（如可得）、错误类型、状态 `failure` 或 `denied`
- **AND** 业务错误 SHALL NOT 阻止审计日志以降级方式记录摘要

#### Scenario: 认证失败不泄露凭证
- **WHEN** 远程 MCP 请求因认证失败被拒绝
- **THEN** 系统 MAY 记录认证失败摘要
- **AND** 日志 SHALL NOT 包含提交的 token、Authorization header 原文或完整远程地址中的敏感查询参数
