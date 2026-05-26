## MODIFIED Requirements

### Requirement: Review apply worktree execution
When the workspace has an initialized git repository, review apply SHALL execute file writes in an isolated git worktree and merge results back to main before updating the search index.

#### Scenario: Apply in worktree with git repo
- **WHEN** a review apply job runs and workspace has `.git` initialized
- **THEN** the processor SHALL create a worktree at `.llmwiki/worktrees/<job-id>/` on branch `job/<job-id>`
- **AND** SHALL run `ApplyFromPlan` targeting the worktree directory
- **AND** SHALL commit wiki changes in the worktree before merging to main

#### Scenario: Merge to main after worktree commit
- **WHEN** worktree commit succeeds
- **THEN** the processor SHALL merge branch `job/<job-id>` into main
- **AND** on merge conflicts SHALL attempt LLM-assisted resolution using the same mechanism as parallel ingest jobs
- **AND** SHALL update the search index only after merge completes

#### Scenario: Worktree cleanup
- **WHEN** review apply succeeds or fails after worktree creation
- **THEN** the processor SHALL remove the worktree and branch

#### Scenario: No git repo fallback
- **WHEN** workspace has no `.git` directory (legacy workspace before repair)
- **THEN** review apply SHALL write directly to the main workspace without worktree
- **AND** SHALL update the search index after apply completes

#### Scenario: Merge commit recorded on review
- **WHEN** review apply merges successfully to main
- **THEN** the system SHALL persist the resulting merge commit SHA on the ingest review record
