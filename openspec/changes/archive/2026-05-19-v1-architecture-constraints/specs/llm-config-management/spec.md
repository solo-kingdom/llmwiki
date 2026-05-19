## ADDED Requirements

### Requirement: UI-first LLM configuration
LLM runtime configuration SHALL be managed primarily through Web UI settings.

#### Scenario: UI updates provider config
- **WHEN** user updates provider/model/base URL/timeout values in Web UI settings
- **THEN** subsequent LLM operations use the updated configuration

### Requirement: Environment variable fallback
Environment variables SHALL act as fallback configuration source when UI-managed values are absent.

#### Scenario: Fallback to environment
- **WHEN** no UI-stored API key exists for selected provider
- **THEN** the service attempts to load provider key from environment variables

### Requirement: Configurable timeout policy
LLM call timeout parameters SHALL be configurable rather than hardcoded.

#### Scenario: Custom timeout applied
- **WHEN** timeout settings are changed in UI configuration
- **THEN** analysis/generation calls enforce the configured timeout values

### Requirement: Provider extensibility
Configuration model SHALL be extensible to support additional model providers without redesigning startup command flags.

#### Scenario: New provider addition
- **WHEN** a new provider type is introduced
- **THEN** its configuration is represented in the UI-centric config model without adding mandatory serve command flags
