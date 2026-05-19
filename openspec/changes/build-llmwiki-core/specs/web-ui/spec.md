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
The system SHALL provide a settings page for configuring LLM provider, API key, model, and other preferences.

#### Scenario: LLM configuration
- **WHEN** user navigates to Settings and enters API key, provider, and model
- **THEN** the configuration SHALL be persisted and used for all subsequent LLM interactions
