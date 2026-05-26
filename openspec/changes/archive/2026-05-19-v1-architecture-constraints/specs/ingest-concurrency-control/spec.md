## ADDED Requirements

### Requirement: Cross-file concurrent ingest
The ingest system SHALL allow concurrent ingestion of different source files.

#### Scenario: Parallel ingest on distinct targets
- **WHEN** two ingest jobs operate on different source files and different target pages
- **THEN** both jobs may proceed concurrently without global serialization

### Requirement: Same-page serialization
The system SHALL serialize writes that target the same page path using a page-level mutex keyed by normalized path.

#### Scenario: Concurrent updates to same page
- **WHEN** two jobs attempt to update `wiki/concepts/attention.md` concurrently
- **THEN** one job acquires the page lock and the other waits until lock release

### Requirement: Lock scope visibility
The system SHALL expose lock wait/hold metrics or logs sufficient to diagnose contention.

#### Scenario: Observing lock contention
- **WHEN** lock wait time exceeds configured threshold
- **THEN** the system emits structured diagnostics containing page path and wait duration
