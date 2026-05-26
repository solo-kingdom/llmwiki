## ADDED Requirements

### Requirement: Session message wiki refs
The system SHALL accept optional wiki page references when posting a session chat message.

#### Scenario: Post message with wiki refs
- **WHEN** client sends `POST /api/v1/ingest/sessions/{id}/messages` with body `{ content, wiki_refs: [{ document_id, relative_path }] }`
- **THEN** the system SHALL validate each ref resolves to an existing wiki document
- **AND** SHALL read full page content for each ref and inject it into the assembled user message context

#### Scenario: Invalid wiki ref rejected
- **WHEN** `wiki_refs` contains a document that does not exist or is not a wiki page
- **THEN** the system SHALL return HTTP 400 without creating a user message

#### Scenario: Wiki refs limit
- **WHEN** client sends more than 5 entries in `wiki_refs`
- **THEN** the system SHALL return HTTP 400

### Requirement: Session references list API
The system SHALL expose session-scoped wiki reference history.

#### Scenario: List session references
- **WHEN** client requests `GET /api/v1/ingest/sessions/{id}/references`
- **THEN** the system SHALL return `[{ document_id, relative_path, title, source, first_seen_at }, ...]` ordered by `first_seen_at`

### Requirement: Session chat tool loop
The system SHALL run a readonly tool-call loop for session chat replies before returning the final assistant message.

#### Scenario: Builtin tools always available
- **WHEN** streaming a chat reply and no external MCP chat servers are configured
- **THEN** the system SHALL still expose builtin `search`, `read`, and `references` tools to the model

#### Scenario: Optional external chat MCP
- **WHEN** MCP servers with `scope.chat=true` are enabled
- **THEN** the system SHALL merge their readonly allowed tools with builtin tools
- **AND** SHALL filter out write tools regardless of server `allow_write_tools`

#### Scenario: Tool loop limits
- **WHEN** session chat tool loop runs
- **THEN** the system SHALL enforce `max_rounds=4` and `max_tool_calls_per_round=4`

### Requirement: Session chat SSE tool events
The system SHALL emit SSE events for tool activity during session chat streaming.

#### Scenario: Tool start event
- **WHEN** the model requests a tool call during session chat
- **THEN** the SSE stream SHALL emit `event: tool_start` with tool name and truncated arguments before execution

#### Scenario: Tool done event
- **WHEN** tool execution completes
- **THEN** the SSE stream SHALL emit `event: tool_done` with tool name and success or error summary

## MODIFIED Requirements

### Requirement: Session chat LLM assembly
The system SHALL assemble ingest session chat messages with a composed system prompt including workspace rules, fidelity constraints, related wiki subset index, and wiki grounding instructions.

#### Scenario: Session system prompt composition
- **WHEN** the API streams a chat reply for an ingest session
- **THEN** the system message SHALL be built via `ComposeSystemPrompt(session_chat, ctx)` with Chinese defaults when `doc_language=zh`
- **AND** the prompt SHALL instruct the model that valid grounds include user messages, attachment summaries, user `@` wiki page full text, and pages read via tools
- **AND** the prompt SHALL instruct the model not to invent wiki content for pages it has not read

#### Scenario: Related subset appended
- **WHEN** ContextResolver returns a non-empty subset for the turn
- **THEN** the assembled system message SHALL include the related wiki subset index section

#### Scenario: Attachment summary prompt language
- **WHEN** the system generates an attachment summary message
- **THEN** the user prompt SHALL be in the session's `doc_language` (Chinese for `zh`)
- **AND** it SHALL instruct summarizing only extracted attachment text without adding external information
