# rollback-job

## Purpose

Queue and execute deterministic rollbacks of a change set.

## Requirements

### Requirement: Enqueue rollback

`POST /api/v1/ingest/rollback` SHALL accept `{"change_set_id": "..."}` and queue an `input_type=rollback` ingest job whose `source_ref` is the change set id. Missing or unknown change sets SHALL return 400/404.

### Requirement: Execute rollback

Processing a rollback job SHALL call the revision store's undo operation inside one transaction, append a `rollback` change set, and mark the job succeeded with the page count. It SHALL NOT read git history or invoke the LLM.

#### Scenario: Repeated rollback request
- **WHEN** a queued rollback job already exists for the same change set
- **THEN** the API SHALL return the existing job id instead of queuing a duplicate
