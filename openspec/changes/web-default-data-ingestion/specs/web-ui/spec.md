## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface that prioritizes data ingestion as the default entry flow, while still supporting wiki browsing, document viewing, and source management.

#### Scenario: Ingest-first default landing
- **WHEN** user opens the Web UI
- **THEN** the default primary view SHALL be the ingest hub instead of document-only browsing

#### Scenario: File tree navigation
- **WHEN** user opens the document browser from the Web UI
- **THEN** a file tree SHALL display the wiki/ and raw/ directory structure with expandable folders

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the file tree
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

## ADDED Requirements

### Requirement: Ingest hub multi-modal submission
The system SHALL provide an ingest hub in Web UI that supports conversational ingest, direct text submission, and file upload ingest within one consistent workflow.

#### Scenario: Conversational ingest flow
- **WHEN** user submits messages in ingest conversation and confirms generated draft
- **THEN** Web UI SHALL create an ingest job and show the new job in task status list

#### Scenario: Direct text submission flow
- **WHEN** user pastes text/markdown in ingest form and clicks submit
- **THEN** Web UI SHALL create an ingest job and present validation or processing feedback inline

#### Scenario: File upload flow
- **WHEN** user uploads files from local device in ingest hub
- **THEN** Web UI SHALL show accepted/rejected files and create ingest jobs for accepted files

### Requirement: Ingest status observability in UI
The system SHALL display ingest job states and actionable diagnostics directly in Web UI.

#### Scenario: Job status list refresh
- **WHEN** there are active ingest jobs
- **THEN** Web UI SHALL refresh and display lifecycle states (`queued`, `running`, `succeeded`, `failed`, `cancelled`)

#### Scenario: Failed job diagnostics
- **WHEN** a job fails due to unsupported format or missing dependency
- **THEN** Web UI SHALL display structured error information and remediation hint to the user
