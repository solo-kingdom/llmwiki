# llm-integration Specification

## Purpose
Define LLM client integration for ingest session streaming chat and tool-call message serialization.

## Requirements

### Requirement: Ingest session streaming chat
The system SHALL provide streaming LLM responses for ingest session turns using the provider instance configured for the session. LLM client creation SHALL resolve the instance ID to catalog provider metadata (api_format, api_base) combined with instance credentials (api_key, optional base_url override) to construct the LLM client configuration.

#### Scenario: Stream assistant reply
- **WHEN** user message is appended to an ingest session
- **THEN** system SHALL resolve the session's `llm_instance_id` to a provider instance, look up the catalog provider's `api_format`, and invoke LLM with the instance's API key and base URL to stream tokens to the client until completion

#### Scenario: Persist completed assistant message
- **WHEN** streaming completes successfully
- **THEN** system SHALL persist the full assistant message content linked to the session

#### Scenario: Stream timeout
- **WHEN** streaming exceeds configured timeout
- **THEN** system SHALL abort stream and return timeout error classifiable by the UI

#### Scenario: Instance not found
- **WHEN** the session's `llm_instance_id` references a deleted or non-existent instance
- **THEN** system SHALL return an error indicating the provider instance is no longer available

#### Scenario: No environment variable fallback
- **WHEN** creating LLM client for a session
- **THEN** system SHALL NOT fall back to environment variables for API keys; keys SHALL only come from the provider instance record

### Requirement: OpenAI-compatible tool_calls message serialization
The system SHALL serialize assistant `tool_calls` in chat API request bodies using the OpenAI Chat Completions format: each element MUST include `id`, `type` set to `"function"`, and a nested `function` object with `name` and `arguments` fields.

#### Scenario: Tool loop round-trip serialization
- **WHEN** a tool loop appends an assistant message with `ToolCalls` to the message history and sends a subsequent chat API request
- **THEN** the serialized `tool_calls` array in the request body SHALL conform to the OpenAI `{id, type, function:{name, arguments}}` structure

#### Scenario: Deserialize API tool_calls response
- **WHEN** the chat API returns an assistant message with `tool_calls` in OpenAI format
- **THEN** the system SHALL parse the response into internal `ToolCall` records with correct `id`, `name`, and `arguments` values

### Requirement: Tool loop assistant and tool message pairing
When the tool loop enforces `MaxToolCallsPerRound`, the system SHALL append an assistant message whose `tool_calls` array contains only the tool calls that are executed in that round, and SHALL append exactly one `role: tool` message per element in that array with a matching `tool_call_id`. The system SHALL NOT include tool calls in the assistant message that lack a corresponding tool result message in the same round.

#### Scenario: Truncated tool calls match tool responses
- **WHEN** the model returns more than `MaxToolCallsPerRound` tool calls in one completion
- **AND** the tool loop executes tools for the first `MaxToolCallsPerRound` calls only
- **THEN** the assistant message appended to history SHALL contain at most `MaxToolCallsPerRound` elements in `tool_calls`
- **AND** the subsequent chat API request SHALL include exactly that many `role: tool` messages with matching `tool_call_id` values

#### Scenario: Sub-max tool calls unchanged
- **WHEN** the model returns N tool calls where N is less than or equal to `MaxToolCallsPerRound`
- **THEN** the assistant message SHALL include all N tool calls
- **AND** the tool loop SHALL append N tool result messages before the next chat API request

#### Scenario: Multi-round tool loop without HTTP 400
- **WHEN** round 0 returns more tool calls than `MaxToolCallsPerRound`
- **AND** round 1 requests another completion with tools
- **THEN** the chat API request SHALL NOT fail with insufficient tool messages following tool_calls

### Requirement: Reasoning content in tool loop round-trip
The system SHALL support `reasoning_content` on assistant messages for OpenAI-compatible chat APIs that use thinking mode with tool calls. When the API returns `reasoning_content` on an assistant message that includes `tool_calls`, subsequent requests in the same tool loop SHALL include that field on the assistant message.

#### Scenario: Parse reasoning_content from chat response
- **WHEN** a non-streaming chat completion returns `choices[0].message.reasoning_content`
- **THEN** the system SHALL store the value on the internal assistant message record

#### Scenario: Pass reasoning_content on tool loop continuation
- **WHEN** `RunToolLoop` appends an assistant message after tool calls were requested
- **AND** the prior response included non-empty `reasoning_content`
- **THEN** the next chat API request body SHALL include `reasoning_content` on that assistant message alongside `tool_calls`

#### Scenario: Tool loop without reasoning_content unchanged
- **WHEN** the API response has no `reasoning_content` field
- **THEN** the system SHALL serialize assistant messages as today (content and tool_calls only)

#### Scenario: DeepSeek thinking tool loop succeeds
- **WHEN** using a DeepSeek thinking-mode model that requires reasoning round-trip
- **AND** the model returns tool_calls with reasoning_content on round 0
- **THEN** round 1 chat request SHALL NOT receive HTTP 400 for missing reasoning_content
