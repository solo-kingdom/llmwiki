## ADDED Requirements

### Requirement: Web ingest file-first persistence boundary
The system SHALL persist Web-submitted ingest inputs as filesystem artifacts before treating ingestion as accepted for processing.

#### Scenario: Direct text persisted before processing
- **WHEN** user submits text/markdown via Web ingest form
- **THEN** system SHALL materialize canonical source content under workspace-managed storage before ingest job processing starts

#### Scenario: Uploaded files persisted before queue enqueue
- **WHEN** user uploads source files via Web ingest hub
- **THEN** system SHALL persist files to workspace source storage and only then enqueue ingest jobs

#### Scenario: Persistence failure blocks ingest acceptance
- **WHEN** workspace write fails due to permission or disk errors
- **THEN** system SHALL reject ingest acceptance and SHALL NOT enqueue processing jobs

### Requirement: Reindex consistency for web-ingested sources
The system SHALL ensure sources created through Web ingest are discoverable and reconstructable by workspace reindex.

#### Scenario: Reindex after database loss includes web-ingested sources
- **WHEN** SQLite index is deleted and `llmwiki reindex` runs
- **THEN** sources persisted via Web ingest SHALL be rediscovered from filesystem and restored into index state
