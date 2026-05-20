## ADDED Requirements

### Requirement: Optional public Wiki access
The system SHALL support an optional public Wiki mode that allows unauthenticated users to read Wiki content through explicitly public, read-only routes.

#### Scenario: Public Wiki disabled by default
- **WHEN** the server is started without enabling public Wiki access
- **THEN** unauthenticated requests to public Wiki API routes SHALL NOT return Wiki document data

#### Scenario: Public Wiki enabled
- **WHEN** public Wiki access is enabled
- **AND** an unauthenticated user requests the public Wiki reader or public Wiki document API
- **THEN** the system SHALL allow read-only access to Wiki document listing and document content

#### Scenario: Management APIs remain private
- **WHEN** token authentication is configured
- **AND** public Wiki access is enabled
- **THEN** unauthenticated requests to management APIs such as ingest, jobs, settings, provider instances, and MCP-related endpoints SHALL remain unauthorized

### Requirement: Public API uses safe response models
The public Wiki API SHALL expose only fields needed for rendering and navigating public Wiki content.

#### Scenario: Listing public documents
- **WHEN** a client requests the public document list
- **THEN** each returned document item SHALL include only safe reader fields such as id, filename, title, path, file type, page count, and update time

#### Scenario: Reading public document content
- **WHEN** a client requests a single public document
- **THEN** the response SHALL include renderable content and safe reader metadata
- **AND** the response SHALL NOT include settings, provider configuration, ingest job internals, secret values, or management-only state

#### Scenario: Public routes are read-only
- **WHEN** a client sends a non-GET request to the public Wiki API
- **THEN** the system SHALL NOT mutate Wiki content or management state through that public route
