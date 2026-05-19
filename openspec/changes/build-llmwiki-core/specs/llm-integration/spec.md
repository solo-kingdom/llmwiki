## ADDED Requirements

### Requirement: Multi-provider LLM streaming client
The system SHALL provide a streaming HTTP client that supports OpenAI and Anthropic API formats, with configurable base URL, API key, model, temperature, and max_tokens.

#### Scenario: OpenAI streaming
- **WHEN** LLM client is configured with provider="openai" and a valid API key
- **THEN** requests SHALL be sent to the OpenAI chat completions endpoint with SSE streaming, and tokens SHALL be emitted as they arrive

#### Scenario: Anthropic streaming
- **WHEN** LLM client is configured with provider="anthropic" and a valid API key
- **THEN** requests SHALL be sent to the Anthropic messages endpoint with SSE streaming

#### Scenario: Custom endpoint
- **WHEN** LLM client is configured with provider="custom" and a custom base URL
- **THEN** requests SHALL be sent to the specified endpoint with OpenAI-compatible format

#### Scenario: Ollama local endpoint
- **WHEN** LLM client is configured with provider="ollama"
- **THEN** requests SHALL be sent to `http://localhost:11434/api/chat`

### Requirement: Conversation context assembly
The system SHALL assemble LLM prompts with system instructions, user messages, assistant history, and wiki context (index, overview, purpose).

#### Scenario: Query with wiki context
- **WHEN** a query is made against the wiki
- **THEN** the system prompt SHALL include: system instructions, purpose.md content, index.md summary, language rules, and citation format directives

### Requirement: Timeout and error handling
The system SHALL implement configurable timeouts for LLM requests (managed via Web UI settings with environment variable fallback) and classify errors (network vs application) for proper retry or user feedback.

#### Scenario: Request timeout
- **WHEN** an LLM request exceeds the configured timeout (default 30 minutes, configurable)
- **THEN** the system SHALL abort the request and return a timeout error message

#### Scenario: Network error classification
- **WHEN** the LLM endpoint is unreachable (DNS failure, connection refused)
- **THEN** the system SHALL return a distinct network error (separate from API errors like 401/429/500)

#### Scenario: Token budget control
- **WHEN** messages would exceed the configured context window
- **THEN** the system SHALL truncate chat history from the oldest messages to fit within the budget

### Requirement: Configurable LLM settings via Web UI
LLM configuration (provider, API key, model, base URL, timeouts) SHALL be managed primarily through Web UI settings stored in `.llmwiki/config.json`, with environment variable fallback when UI-managed values are absent.

#### Scenario: UI updates provider config
- **WHEN** user updates provider/model/base URL/timeout values in Web UI settings
- **THEN** subsequent LLM operations use the updated configuration

#### Scenario: Environment variable fallback
- **WHEN** no UI-stored API key exists for selected provider
- **THEN** the service attempts to load provider key from environment variables

#### Scenario: Provider extensibility
- **WHEN** a new provider type is introduced
- **THEN** its configuration is represented in the UI-centric config model without adding mandatory serve command flags
