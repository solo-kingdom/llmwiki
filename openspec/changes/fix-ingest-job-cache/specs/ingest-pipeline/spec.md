## MODIFIED Requirements

### Requirement: SHA256 incremental cache
The ingest pipeline SHALL skip LLM analysis and generation when the source content hash matches a cached entry for the same canonical path.

#### Scenario: File ingest cache hit
- **WHEN** `Ingest()` is called on a source file whose SHA256 matches the cache entry
- **THEN** the pipeline SHALL skip LLM steps and return previously written wiki paths

#### Scenario: Normalized ingest cache hit
- **WHEN** `IngestNormalized()` is called with content whose SHA256 matches a cached entry for the same canonical path
- **THEN** the pipeline SHALL skip LLM steps and return previously written wiki paths

#### Scenario: Cache miss on content change
- **WHEN** source content SHA256 differs from cached entry
- **THEN** the pipeline SHALL run full two-step ingest and update the cache entry

#### Scenario: Cache miss when written files missing
- **WHEN** cache entry exists but one or more `WrittenFiles` no longer exist on disk
- **THEN** the pipeline SHALL treat as cache miss and re-run ingest
