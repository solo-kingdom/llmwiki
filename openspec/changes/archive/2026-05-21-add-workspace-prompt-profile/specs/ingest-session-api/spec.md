## MODIFIED Requirements

### Requirement: Session chat LLM assembly
The system SHALL assemble ingest session chat messages with a composed system prompt including workspace rules and fidelity constraints.

#### Scenario: Session system prompt composition
- **WHEN** the API streams a chat reply for an ingest session
- **THEN** the system message SHALL be built via `ComposeSystemPrompt(session_chat, ctx)` with Chinese defaults when `doc_language=zh`
- **AND** the prompt SHALL instruct the model not to invent facts beyond user messages and attachment summaries

#### Scenario: Attachment summary prompt language
- **WHEN** the system generates an attachment summary message
- **THEN** the user prompt SHALL be in the session's `doc_language` (Chinese for `zh`)
- **AND** it SHALL instruct summarizing only extracted attachment text without adding external information
