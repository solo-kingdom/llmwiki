## Requirements

### Requirement: Centralized prompt composition
The system SHALL build LLM system prompts for ingest-related steps through a single composer that concatenates segments in a fixed priority order.

#### Scenario: Locked segments cannot be overridden
- **WHEN** `ComposeSystemPrompt` is called for any step
- **THEN** the output SHALL always include locked format constraints (FILE block syntax, no preamble) and fidelity constraints before any user-supplied append content
- **AND** user append content SHALL NOT remove or precede locked segments

#### Scenario: Workspace file injection
- **WHEN** `purpose.md` and/or `rules.md` exist in the workspace root
- **THEN** the composer SHALL append truncated content from each file (default max 1500 characters per file) under clearly labeled sections
- **WHEN** a file is missing or empty
- **THEN** the composer SHALL omit that section without error

#### Scenario: Append-only prompts.yaml
- **WHEN** `.llmwiki/prompts.yaml` contains `steps.<step>.append` for the requested step
- **THEN** the composer SHALL append that text after workspace file sections
- **WHEN** the YAML contains a `replace` key for any step
- **THEN** the system SHALL ignore `replace` and SHALL NOT use it in composed prompts

#### Scenario: Settings supplement append
- **WHEN** `rules_supplement` in `app_config` is non-empty
- **THEN** the composer SHALL append it after `prompts.yaml` append content and before `doc_language` language instruction

### Requirement: Chinese default step templates
For `doc_language=zh`, default (non-user) task instructions in composed prompts SHALL be written in Chinese.

#### Scenario: Analysis default language
- **WHEN** the analysis step runs with `doc_language=zh`
- **THEN** the default task portion of the system prompt SHALL be Chinese and SHALL request structured analysis tied to the source document

#### Scenario: Generation default language
- **WHEN** the generation step runs with `doc_language=zh`
- **THEN** the default task portion SHALL be Chinese and SHALL require FILE block output starting with `---FILE:`

### Requirement: Source-fidelity locked instruction
The composed prompt SHALL include a locked fidelity instruction requiring outputs to stay grounded in provided source content.

#### Scenario: Fidelity instruction present for ingest generation
- **WHEN** the generation step system prompt is composed
- **THEN** it SHALL instruct the model not to add unsupported facts or long background not present in the source
- **AND** it SHALL instruct placing unsupported inferences in Open Questions or equivalent section

### Requirement: Rules hash snapshot
When an ingest job is created, the system SHALL record a `rules_hash` in job execution events derived from `purpose.md`, `rules.md`, `rules_supplement`, and canonical `prompts.yaml` content.

#### Scenario: Hash recorded on enqueue
- **WHEN** a new ingest job is enqueued
- **THEN** job execution events SHALL include `rules_hash` as a hex digest on the queued system event
- **AND** the hash SHALL change when any contributing rules file or supplement changes
