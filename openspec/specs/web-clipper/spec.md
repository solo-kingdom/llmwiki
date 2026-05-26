## Requirements

### Requirement: Chrome Web Clipper extension
The project SHALL provide a Chrome Extension (Manifest V3) that clips the current web page to Markdown and submits it to the llmwiki ingest API.

#### Scenario: Clip and submit
- **WHEN** user clicks the extension action on a web page
- **THEN** the extension SHALL extract readable content, convert to Markdown, and POST to the configured llmwiki server ingest endpoint

#### Scenario: Server URL configuration
- **WHEN** user opens extension popup settings
- **THEN** user SHALL be able to configure the llmwiki server base URL (default http://localhost:8868)

#### Scenario: Success feedback
- **WHEN** ingest submission succeeds
- **THEN** popup SHALL display success message with job reference in Chinese

#### Scenario: Failure feedback
- **WHEN** server is unreachable or ingest fails
- **THEN** popup SHALL display error message in Chinese
