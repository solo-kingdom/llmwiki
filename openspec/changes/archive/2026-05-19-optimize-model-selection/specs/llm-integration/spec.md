## MODIFIED Requirements

### Requirement: Ingest session streaming chat
The system SHALL provide streaming LLM responses for ingest session turns. LLM Client SHALL be created per-session using the session's provider and model, falling back to global defaults, with API Key read from the per-provider key store.

#### Scenario: Stream assistant reply with session-level config
- **WHEN** user message is appended to an ingest session that has `llm_provider` and `llm_model` set
- **THEN** system SHALL create a new `llm.Client` using the session's provider and model, read API Key from `provider_keys` table for that provider, and invoke LLM to stream tokens

#### Scenario: Fallback to global defaults
- **WHEN** session does not have `llm_provider` or `llm_model` set
- **THEN** system SHALL read `last_provider` and `last_model` from `app_config` table, create LLM Client with those values

#### Scenario: No provider configured
- **WHEN** session has no provider/model AND `app_config` has no `last_provider`
- **THEN** system SHALL return HTTP 400 with message indicating provider/model must be configured

#### Scenario: API Key missing for provider
- **WHEN** the required provider has no API Key in `provider_keys` table and no matching environment variable
- **THEN** system SHALL return HTTP 400 with message indicating API Key must be configured for that provider

#### Scenario: Persist completed assistant message
- **WHEN** streaming completes successfully
- **THEN** system SHALL persist the full assistant message content linked to the session

#### Scenario: Stream timeout
- **WHEN** streaming exceeds configured timeout
- **THEN** system SHALL abort stream and return timeout error classifiable by the UI
