## MODIFIED Requirements

### Requirement: Ingest session streaming chat
The system SHALL provide streaming LLM responses for ingest session turns when the session's agent runtime is `native`. Native LLM client creation SHALL resolve the instance ID to catalog provider metadata (api_format, api_base) combined with instance credentials (api_key, optional base_url override) to construct the LLM client configuration. When the session's agent runtime is `acp`, the system SHALL NOT construct an LLM client and SHALL NOT read `provider_instances`.

#### Scenario: Stream assistant reply
- **WHEN** user message is appended to an ingest session whose `agent_kind` is `native`
- **THEN** system SHALL resolve the session's `llm_instance_id` to a provider instance, look up the catalog provider's `api_format`, and invoke LLM with the instance's API key and base URL to stream tokens to the client until completion

#### Scenario: Persist completed assistant message
- **WHEN** streaming completes successfully
- **THEN** system SHALL persist the full assistant message content linked to the session

#### Scenario: Stream timeout
- **WHEN** streaming exceeds configured timeout
- **THEN** system SHALL abort stream and return timeout error classifiable by the UI

#### Scenario: Instance not found
- **WHEN** a `native` session's `llm_instance_id` references a deleted or non-existent instance
- **THEN** system SHALL return an error indicating the provider instance is no longer available

#### Scenario: No environment variable fallback
- **WHEN** creating LLM client for a `native` session
- **THEN** system SHALL NOT fall back to environment variables for API keys; keys SHALL only come from the provider instance record

#### Scenario: ACP session bypasses provider instance resolution
- **WHEN** user message is appended to an ingest session whose `agent_kind` is `acp`
- **THEN** system SHALL NOT call `llm.ClientFromInstance`
- **AND** SHALL NOT return an error caused by a missing provider instance, missing model, or empty `api_key`
- **AND** the session's stored `llm_instance_id` and `llm_model` SHALL remain unchanged so that switching back to `native` restores the previous selection

## ADDED Requirements

### Requirement: LLM client 只服务 native runtime
`llm.ClientFromInstance` 与 `llm.Client` SHALL 只被 native agent runtime 与非会话路径（如附件摘要、ingest job pipeline）使用。ACP runtime SHALL NOT 依赖 `internal/llm` 的任何类型。

#### Scenario: 附件摘要仍走 native LLM
- **WHEN** 客户端上传 session 附件
- **THEN** 系统 SHALL 继续使用全局默认 instance/model 生成摘要（`last_instance_id` / `last_model`）
- **AND** 该行为 SHALL NOT 受 session 的 `agent_kind` 影响

#### Scenario: Ingest job pipeline 不受影响
- **WHEN** ingest job、review plan 或 archive apply 执行
- **THEN** 系统 SHALL 继续使用 native LLM 路径
- **AND** SHALL NOT 因任何 session 或全局默认为 `acp` 而改变行为

#### Scenario: ACP runtime 不引用 LLM 类型
- **WHEN** 检查 ACP runtime 实现的依赖
- **THEN** 其函数签名与结构体字段 SHALL NOT 出现 `llm.Client`、`llm.Config`、`llm.Message` 或 `llm.ToolDefinition`
