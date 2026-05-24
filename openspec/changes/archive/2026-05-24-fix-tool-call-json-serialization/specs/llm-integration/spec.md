## ADDED Requirements

### Requirement: OpenAI-compatible tool_calls message serialization
The system SHALL serialize assistant `tool_calls` in chat API request bodies using the OpenAI Chat Completions format: each element MUST include `id`, `type` set to `"function"`, and a nested `function` object with `name` and `arguments` fields.

#### Scenario: Tool loop round-trip serialization
- **WHEN** a tool loop appends an assistant message with `ToolCalls` to the message history and sends a subsequent chat API request
- **THEN** the serialized `tool_calls` array in the request body SHALL conform to the OpenAI `{id, type, function:{name, arguments}}` structure

#### Scenario: Deserialize API tool_calls response
- **WHEN** the chat API returns an assistant message with `tool_calls` in OpenAI format
- **THEN** the system SHALL parse the response into internal `ToolCall` records with correct `id`, `name`, and `arguments` values
