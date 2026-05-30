## MODIFIED Requirements

### Requirement: Review plan step prompt composition
The ingest review plan step SHALL use the same prompt composer with step `plan`, including workspace rules and append-only overrides. The plan JSON schema SHALL support optional `from_path`, `to_path`, and `source_paths` fields for move and merge actions.

#### Scenario: Plan step uses composed prompt
- **WHEN** the pipeline runs the review plan LLM step
- **THEN** the system message SHALL be produced by `ComposeSystemPrompt(plan, ctx)` and SHALL NOT output FILE blocks
- **AND** plan JSON examples in the prompt SHALL use `wiki/` prefixed paths in `changes[].path`

#### Scenario: Plan prompt includes move schema
- **WHEN** the plan step runs for an organize mode session
- **THEN** the plan JSON example SHALL include `from_path` and `to_path` fields for move actions
- **AND** SHALL include `source_paths` and `to_path` fields for merge actions

#### Scenario: Deep organize injects similar pages
- **WHEN** the plan step runs for an organize session with `deep_organize=true`
- **THEN** the system SHALL run FTS content similarity scan before plan generation
- **AND** SHALL inject detected similar page pairs into the plan prompt as context

## MODIFIED Requirements

### Requirement: Wiki file application with merge protection
When applying LLM-generated FILE blocks to existing wiki pages, the pipeline SHALL merge with existing content instead of blind overwrite. For organize mode apply, the pipeline SHALL additionally inject DELETE blocks for move/merge source paths before calling `ApplyWikiBlocks`.

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

#### Scenario: Post-apply DELETE for move source
- **WHEN** apply runs for a review plan containing a move action with `from_path`
- **THEN** the system SHALL inject a `---DELETE---` block for the `from_path` file
- **AND** SHALL NOT inject DELETE if `from_path` matches a FILE block write target

#### Scenario: Post-apply DELETE for merge sources
- **WHEN** apply runs for a review plan containing a merge action with `source_paths`
- **THEN** the system SHALL inject `---DELETE---` blocks for each source path not equal to `to_path`
- **AND** SHALL NOT inject DELETE for paths that match FILE block write targets
