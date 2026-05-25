## ADDED Requirements

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
