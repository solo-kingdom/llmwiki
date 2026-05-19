## MODIFIED Requirements

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
