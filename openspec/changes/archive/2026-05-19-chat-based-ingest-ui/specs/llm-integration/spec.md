## ADDED Requirements

### Requirement: Ingest session streaming chat
The system SHALL provide streaming LLM responses for ingest session turns using the configured provider from Web UI settings.

#### Scenario: Stream assistant reply
- **WHEN** user message is appended to an ingest session
- **THEN** system SHALL invoke LLM with ingest-specific system prompt and stream tokens to the client until completion

#### Scenario: Persist completed assistant message
- **WHEN** streaming completes successfully
- **THEN** system SHALL persist the full assistant message content linked to the session

#### Scenario: Stream timeout
- **WHEN** streaming exceeds configured timeout
- **THEN** system SHALL abort stream and return timeout error classifiable by the UI

### Requirement: Ingest session context assembly
The system SHALL assemble prompts from ingest session history, attachment summaries, and minimal wiki context pointers.

#### Scenario: Include recent history
- **WHEN** building prompt for a new user turn
- **THEN** system SHALL include ordered prior user/assistant messages within token budget (oldest truncated first)

#### Scenario: Include attachment summaries
- **WHEN** session has attachment summary messages
- **THEN** those summaries SHALL be included in context for subsequent turns and archive normalization

### Requirement: Attachment understanding for ingest sessions
The system SHALL generate attachment understanding content via LLM or existing extractors and surface it as assistant-visible text for the session.

#### Scenario: Image attachment summary
- **WHEN** user uploads a supported image attachment
- **THEN** system SHALL produce a text summary suitable for chat display and downstream archive

#### Scenario: Document attachment summary
- **WHEN** user uploads a supported document with extract tier available
- **THEN** system SHALL produce extracted or summarized text; if extraction unavailable, return structured failure with remediation
