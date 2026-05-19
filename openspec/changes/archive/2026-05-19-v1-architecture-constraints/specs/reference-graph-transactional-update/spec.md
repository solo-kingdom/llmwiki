## ADDED Requirements

### Requirement: Transactional reference graph update
Reference graph refresh SHALL execute in a database transaction covering stale-edge deletion and new-edge upsert operations.

#### Scenario: Atomic graph refresh
- **WHEN** a page write triggers reference graph recomputation
- **THEN** old edges and new edges are updated atomically within one transaction

### Requirement: Idempotent edge upsert
Reference edge writes SHALL be idempotent using uniqueness constraints and upsert semantics.

#### Scenario: Retry-safe edge write
- **WHEN** the same reference update is retried after transient failure
- **THEN** duplicate graph edges are not created and final graph state remains correct

### Requirement: Failure rollback
If graph update fails during transaction execution, partial changes SHALL be rolled back.

#### Scenario: Mid-update failure
- **WHEN** an error occurs after deleting old references but before inserting all new references
- **THEN** transaction rollback restores pre-update graph state
