# ingest-pipeline Specification

## Purpose
Define the two-step ingest pipeline: normalization, analysis, generation, caching, merge protection, and session archive handling.
## Requirements
### Requirement: Session archive ingest input
The ingest pipeline SHALL accept `session_archive` input type where normalized content is a frozen session transcript markdown file on disk, including referenced wiki page metadata when present.

#### Scenario: Session archive normalization
- **WHEN** ingest job has `input_type=session_archive` and valid `source_path`
- **THEN** system SHALL load transcript markdown as normalized source content for the two-step pipeline
- **AND** SHALL preserve `referenced_wiki_pages` frontmatter fields when present

#### Scenario: Session archive pipeline execution
- **WHEN** session archive job enters processing
- **THEN** system SHALL execute the same analysis and generation steps as conversation ingest jobs

#### Scenario: Plan considers referenced wiki pages
- **WHEN** review plan or analysis runs on a session archive containing `referenced_wiki_pages`
- **THEN** the pipeline SHALL treat listed paths as existing wiki anchors and prefer update/merge actions over blind create for those paths in plan output

### Requirement: Two-step ingest pipeline
The system SHALL orchestrate a two-step LLM pipeline for ingestion jobs: first analyzing normalized ingest content, then generating wiki page files based on the analysis. System prompts for both steps SHALL be composed via `ComposeSystemPrompt` including workspace `purpose.md`, `rules.md`, optional `.llmwiki/prompts.yaml` append segments, and `rules_supplement` from settings. The generation step SHALL also include typed wiki organization rules and SHALL require generated wiki page text to use the active `doc_language` setting by default.

#### Scenario: Analysis step
- **WHEN** an ingest job enters processing stage with normalized source content
- **THEN** the system SHALL send the content to the LLM with a composed Chinese (when `doc_language=zh`) system prompt requesting structured analysis of entities, concepts, arguments, connections to existing wiki, contradictions, and structural recommendations, grounded in the source without external hallucination (temperature=0.1, max_tokens=4096)

#### Scenario: Generation step
- **WHEN** the analysis step completes
- **THEN** the system SHALL send the original normalized content and analysis results to the LLM with a composed system prompt requesting FILE block output (temperature=0.1, max_tokens=8192), starting with `---FILE:` immediately with no preamble, with fidelity constraints prohibiting content not supported by the source
- **AND** the generation system prompt SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query) referencing `wiki/templates/`
- **AND** the generation system prompt SHALL instruct the model to write business pages only under typed wiki directories, not as `wiki/*.md` top-level pages
- **AND** the generation format contract SHALL require FILE paths to use the `wiki/` prefix (e.g. `wiki/entities/Page.md`, not `entity/Page.md`)
- **AND** generated titles, descriptions, headings, and body text SHALL use the active `doc_language` setting by default

#### Scenario: Template-aware generation prompt
- **WHEN** the pipeline runs the generation LLM step
- **THEN** the system message SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query)
- **AND** the system message SHALL map each page type to its allowed typed directory

#### Scenario: Conversational draft as ingest input
- **WHEN** a user-confirmed conversational draft is submitted via legacy conversation API
- **THEN** the pipeline SHALL normalize draft content into source input and process it through the same two-step flow

#### Scenario: Session archive as ingest input
- **WHEN** an ingest job is created from session archive API
- **THEN** the pipeline SHALL normalize the session archive markdown and process it through the same two-step flow

### Requirement: Pipeline execution recording
The ingest pipeline SHALL emit structured execution events to the job recorder for the active ingest job.

#### Scenario: Normalize step recorded
- **WHEN** job source is normalized
- **THEN** pipeline SHALL record `step=normalize` with `phase=complete` and canonical path metadata

#### Scenario: Analysis request recorded
- **WHEN** analysis LLM call starts
- **THEN** pipeline SHALL record `step=analysis`, `phase=request` with messages and model parameters

#### Scenario: Analysis response recorded
- **WHEN** analysis stream completes successfully
- **THEN** pipeline SHALL record `step=analysis`, `phase=response` with assembled text preview and timing

#### Scenario: Generation request and response recorded
- **WHEN** generation LLM call runs
- **THEN** pipeline SHALL record request and response events analogous to analysis

#### Scenario: Pipeline error recorded
- **WHEN** analysis or generation fails
- **THEN** pipeline SHALL record `phase=error` with error message before job transitions to `failed`

#### Scenario: Apply files recorded
- **WHEN** wiki FILE blocks are applied to workspace
- **THEN** pipeline SHALL record `step=apply_files`, `phase=complete` with written and deleted paths

#### Scenario: Cache hit recorded
- **WHEN** ingest pipeline skips LLM steps due to SHA256 cache hit
- **THEN** pipeline SHALL record `step=cache`, `phase=hit` with canonical path and written paths metadata

#### Scenario: Git commit recorded
- **WHEN** version control is enabled and commit runs for the job
- **THEN** processor SHALL record `step=git_commit` with success SHA or error details

#### Scenario: Index step recorded
- **WHEN** post-ingest file indexing runs
- **THEN** processor SHALL record per-file or summary `step=index` events for failures at minimum

### Requirement: Review plan step prompt composition
The ingest review plan step SHALL use the same prompt composer with step `plan`, including workspace rules and append-only overrides.

#### Scenario: Plan step uses composed prompt
- **WHEN** the pipeline runs the review plan LLM step
- **THEN** the system message SHALL be produced by `ComposeSystemPrompt(plan, ctx)` and SHALL NOT output FILE blocks
- **AND** plan JSON examples in the prompt SHALL use `wiki/` prefixed paths in `changes[].path`

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

### Requirement: Wiki file application with merge protection
When applying LLM-generated FILE blocks to existing wiki pages, the pipeline SHALL merge with existing content instead of blind overwrite.

#### Scenario: New page direct write
- **WHEN** FILE block targets a path that does not exist
- **THEN** the system SHALL write the new content directly

#### Scenario: Existing page field merge
- **WHEN** FILE block targets an existing wiki page
- **THEN** locked frontmatter fields (type, title, created) SHALL be preserved from existing file
- **AND** array fields (tags, sources, related) SHALL be union-merged without duplicates

#### Scenario: Existing page body merge
- **WHEN** new body content differs from existing body
- **THEN** the system SHALL invoke LLM-assisted merge preserving existing information
- **AND** merged body length SHALL NOT be less than 70% of existing body length

#### Scenario: Merge failure aborts write
- **WHEN** merge fails or length guard triggers
- **THEN** the system SHALL NOT write partial content and SHALL return an error

#### Scenario: Force overwrite bypass
- **WHEN** ingest is invoked with force overwrite enabled
- **THEN** the system SHALL skip merge and overwrite as current behavior

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

### Requirement: Typed wiki FILE block application
When applying LLM-generated FILE blocks, the system SHALL reject new business wiki pages that target `wiki/` top-level paths outside the reserved top-level pages.

#### Scenario: Typed content page accepted
- **WHEN** a FILE block targets `wiki/entities/dsp.md`
- **THEN** the system SHALL accept the path for writing if other validation passes

#### Scenario: Reserved top-level page accepted
- **WHEN** a FILE block targets `wiki/overview.md`, `wiki/index.md`, or `wiki/log.md`
- **THEN** the system SHALL accept the path as a reserved top-level wiki page if other validation passes

#### Scenario: Top-level business page rejected
- **WHEN** a FILE block targets `wiki/dsp.md`
- **THEN** the system SHALL reject the block with an error that identifies the path as a misplaced business page
- **AND** the error SHALL list the allowed typed wiki directories

#### Scenario: Template target rejected for ingest output
- **WHEN** an ingest generation FILE block targets `wiki/templates/entity.md`
- **THEN** the system SHALL reject the block as a system template path
- **AND** SHALL NOT overwrite the scaffold template

