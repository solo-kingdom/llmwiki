## ADDED Requirements

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
