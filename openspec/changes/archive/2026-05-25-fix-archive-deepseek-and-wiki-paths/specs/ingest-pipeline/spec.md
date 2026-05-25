## ADDED Requirements

### Requirement: Wiki FILE path normalization before apply
Before applying LLM FILE blocks to the workspace, the ingest pipeline SHALL normalize relative paths to typed wiki locations under the `wiki/` prefix.

#### Scenario: Normalize entity shorthand path
- **WHEN** a FILE block path is `entity/RT-Merger.md`
- **THEN** the system SHALL normalize it to `wiki/entities/RT-Merger.md` before write

#### Scenario: Normalize concept and source shorthand
- **WHEN** a FILE block path starts with `concept/` or `source/` (singular)
- **THEN** the system SHALL map to `wiki/concepts/` or `wiki/sources/` respectively

#### Scenario: Preserve already correct wiki paths
- **WHEN** a FILE block path already starts with `wiki/entities/`, `wiki/concepts/`, or other allowed typed subdirectories
- **THEN** the system SHALL NOT alter the path

#### Scenario: Unrecognized path prefix fails apply
- **WHEN** a FILE block path cannot be normalized to a valid wiki write path
- **THEN** apply SHALL fail with an error indicating invalid FILE path
- **AND** SHALL NOT silently skip the block

### Requirement: Zero wiki files written is apply failure
When FILE blocks are parsed and at least one block is present, applying them MUST result in at least one written wiki file; otherwise the ingest or review apply job SHALL fail.

#### Scenario: Review apply with parsed blocks but zero writes
- **WHEN** review apply completes generation and `parseFileBlocksWithContent` returns one or more blocks
- **AND** `ApplyWikiBlocks` writes zero files after normalization
- **THEN** the apply job SHALL transition to `failed` with error code `no_wiki_files_written`
- **AND** the ingest review SHALL transition to `failed`

#### Scenario: Record skipped paths on normalization
- **WHEN** path normalization adjusts one or more FILE block paths
- **THEN** the job recorder SHALL record a warn event listing original and normalized paths

#### Scenario: Successful apply records written paths
- **WHEN** one or more wiki files are written
- **THEN** `apply_files` complete event SHALL include non-empty `paths_written`

## MODIFIED Requirements

### Requirement: Two-step ingest pipeline
The system SHALL orchestrate a two-step LLM pipeline for ingestion jobs: first analyzing normalized ingest content, then generating wiki page files based on the analysis. System prompts for both steps SHALL be composed via `ComposeSystemPrompt` including workspace `purpose.md`, `rules.md`, optional `.llmwiki/prompts.yaml` append segments, and `rules_supplement` from settings.

#### Scenario: Analysis step
- **WHEN** an ingest job enters processing stage with normalized source content
- **THEN** the system SHALL send the content to the LLM with a composed Chinese (when `doc_language=zh`) system prompt requesting structured analysis of entities, concepts, arguments, connections to existing wiki, contradictions, and structural recommendations, grounded in the source without external hallucination (temperature=0.1, max_tokens=4096)

#### Scenario: Generation step
- **WHEN** the analysis step completes
- **THEN** the system SHALL send the original normalized content and analysis results to the LLM with a composed system prompt requesting FILE block output (temperature=0.1, max_tokens=8192), starting with `---FILE:` immediately with no preamble, with fidelity constraints prohibiting content not supported by the source
- **AND** the generation system prompt SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query) referencing `wiki/templates/`
- **AND** the generation format contract SHALL require FILE paths to use the `wiki/` prefix (e.g. `wiki/entities/Page.md`, not `entity/Page.md`)

#### Scenario: Template-aware generation prompt
- **WHEN** the pipeline runs the generation LLM step
- **THEN** the system message SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query)

#### Scenario: Conversational draft as ingest input
- **WHEN** a user-confirmed conversational draft is submitted via legacy conversation API
- **THEN** the pipeline SHALL normalize draft content into source input and process it through the same two-step flow

#### Scenario: Session archive as ingest input
- **WHEN** an ingest job is created from session archive API
- **THEN** the pipeline SHALL normalize the session archive markdown and process it through the same two-step flow

### Requirement: Review plan step prompt composition
The ingest review plan step SHALL use the same prompt composer with step `plan`, including workspace rules and append-only overrides.

#### Scenario: Plan step uses composed prompt
- **WHEN** the pipeline runs the review plan LLM step
- **THEN** the system message SHALL be produced by `ComposeSystemPrompt(plan, ctx)` and SHALL NOT output FILE blocks
- **AND** plan JSON examples in the prompt SHALL use `wiki/` prefixed paths in `changes[].path`

### Requirement: Review apply worktree execution
When the workspace has an initialized git repository, review apply SHALL execute file writes in an isolated git worktree and merge results back to main before updating the search index.

#### Scenario: Apply in worktree with git repo
- **WHEN** a review apply job runs and workspace has `.git` initialized
- **THEN** the processor SHALL create a worktree at `.llmwiki/worktrees/<job-id>/` on branch `job/<job-id>`
- **AND** SHALL run `ApplyFromPlan` targeting the worktree directory
- **AND** SHALL commit wiki changes in the worktree before merging to main

#### Scenario: Merge to main after worktree commit
- **WHEN** worktree commit succeeds with at least one wiki file written
- **THEN** the processor SHALL merge branch `job/<job-id>` into main
- **AND** on merge conflicts SHALL attempt LLM-assisted resolution using the same mechanism as parallel ingest jobs
- **AND** SHALL update the search index only after merge completes

#### Scenario: No files written skips merge
- **WHEN** review apply parses FILE blocks but writes zero wiki files
- **THEN** the processor SHALL NOT mark the review or job as succeeded
- **AND** SHALL NOT record a merge commit SHA

#### Scenario: Worktree cleanup
- **WHEN** review apply succeeds or fails after worktree creation
- **THEN** the processor SHALL remove the worktree and branch

#### Scenario: No git repo fallback
- **WHEN** workspace has no `.git` directory (legacy workspace before repair)
- **THEN** review apply SHALL write directly to the main workspace without worktree
- **AND** SHALL update the search index after apply completes with at least one file written

#### Scenario: Merge commit recorded on review
- **WHEN** review apply merges successfully to main with wiki changes
- **THEN** the system SHALL persist the resulting merge commit SHA on the ingest review record
