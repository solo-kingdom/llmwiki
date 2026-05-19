## ADDED Requirements

### Requirement: Embedded SPA
The system SHALL embed a React single-page application built with Vite and TypeScript, served from the Go binary via `embed.FS`.

#### Scenario: Web UI served at root
- **WHEN** user navigates to `http://localhost:8868/`
- **THEN** the React application SHALL load and render the UI

#### Scenario: SPA routing fallback
- **WHEN** user navigates to `http://localhost:8868/documents/some-page`
- **THEN** the Go server SHALL return `index.html` (not a 404), allowing client-side routing to handle the path

#### Scenario: API routes not affected
- **WHEN** user navigates to `http://localhost:8868/api/v1/health`
- **THEN** the Go server SHALL return the JSON API response (not the SPA)

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki pages, viewing document content, and managing source files.

#### Scenario: File tree navigation
- **WHEN** user opens the Web UI
- **THEN** a file tree SHALL display the wiki/ and raw/ directory structure with expandable folders

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the file tree
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

### Requirement: Search interface
The system SHALL provide a search bar in the Web UI for full-text searching across wiki pages and source documents.

#### Scenario: Search results displayed
- **WHEN** user types a query in the search bar
- **THEN** search results SHALL appear with matched chunk snippets, file names, and relevance scores

### Requirement: Settings page
The system SHALL provide a settings page as the primary interface for configuring LLM provider, API key, model, base URL, timeouts, and other preferences. Configuration is persisted to `.llmwiki/config.json`.

#### Scenario: LLM configuration
- **WHEN** user navigates to Settings and enters API key, provider, and model
- **THEN** the configuration SHALL be persisted to `.llmwiki/config.json` and used for all subsequent LLM interactions

#### Scenario: Timeout configuration
- **WHEN** user adjusts request timeout or streaming idle timeout in Settings
- **THEN** the new timeout values SHALL be applied to subsequent LLM calls

#### Scenario: Environment variable fallback visible
- **WHEN** a provider has no UI-stored API key and is using an environment variable
- **THEN** the Settings page SHALL indicate that an environment variable is active for that provider

<!-- v1-architecture-constraints codified: llm-config-management (UI-first config, env var fallback, configurable timeout already present) -->

<!-- Added by change: v1-architecture-constraints -->

## Constraints from v1-architecture-constraints

### Requirement: Provider extensibility
Configuration model SHALL be extensible to support additional model providers without redesigning startup command flags.

#### Scenario: New provider addition
- **WHEN** a new provider type is introduced
- **THEN** its configuration is represented in the UI-centric config model without adding mandatory serve command flags
