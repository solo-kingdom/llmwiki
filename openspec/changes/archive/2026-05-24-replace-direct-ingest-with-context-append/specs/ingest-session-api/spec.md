## ADDED Requirements

### Requirement: Context-only session message append
The system SHALL support appending a user message to an ingest session without triggering an assistant LLM reply when the client posts a message without streaming.

#### Scenario: Non-stream append persists user message only
- **WHEN** client sends `POST /api/v1/ingest/sessions/{id}/messages` with a non-empty `content` body
- **AND** the request does NOT use `stream=1` query parameter
- **AND** the request does NOT use `Accept: text/event-stream`
- **THEN** the system SHALL create a persisted `role=user` message with `stream_status=complete`
- **AND** SHALL NOT create an assistant message
- **AND** SHALL NOT invoke the session chat LLM reply pipeline
- **AND** SHALL return HTTP 201 with the created message

#### Scenario: Stream append unchanged
- **WHEN** client sends `POST /api/v1/ingest/sessions/{id}/messages` with `stream=1` or SSE Accept header
- **THEN** the system SHALL continue to stream an assistant reply per existing session chat behavior

#### Scenario: Context message included in archive
- **WHEN** client posts archive for a session containing context-only user messages (non-excluded)
- **THEN** those messages SHALL appear in the generated archive markdown transcript like other user messages
