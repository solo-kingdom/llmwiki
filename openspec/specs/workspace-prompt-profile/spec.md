# workspace-prompt-profile Specification

## Purpose
Define centralized prompt composition for ingest-related LLM steps, including workspace rules injection and session chat wiki grounding defaults.

## Requirements

### Requirement: Centralized prompt composition
The system SHALL build LLM system prompts for ingest-related steps through a single composer that concatenates segments in a fixed priority order. The composer SHALL include the active `doc_language` language instruction for generation, planning, rollback, merge, and session archive flows that create or reshape wiki text.

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

#### Scenario: Document language instruction last
- **WHEN** `ComposeSystemPrompt` is called with `doc_language=zh` or `doc_language=en`
- **THEN** the prompt SHALL include the matching document language instruction after workspace rules and settings supplements

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

### Requirement: Session chat wiki grounding defaults
For `session_chat`, default task instructions in composed prompts SHALL define wiki-aware grounding rules when `doc_language` is `zh` or `en`.

#### Scenario: Chinese session chat defaults
- **WHEN** `ComposeSystemPrompt(session_chat, ctx)` runs with `doc_language=zh`
- **THEN** the default task portion SHALL state that responses MAY use user messages, attachment summaries, user `@` wiki page full text, and tool-read wiki pages as grounds
- **AND** SHALL state the model MUST NOT claim existing wiki content for paths it has not read
- **AND** SHALL state the related subset index is a navigation hint only, not full content

#### Scenario: English session chat defaults
- **WHEN** `ComposeSystemPrompt(session_chat, ctx)` runs with `doc_language=en`
- **THEN** the default task portion SHALL express the same wiki grounding rules in English

### Requirement: Document language enforcement for wiki text
The system SHALL use `doc_language` as the default language for generated wiki text, including ingest generation, session archive planning, organize planning, rollback regeneration, and merge-body output.

#### Scenario: Chinese document language
- **WHEN** a wiki-generating step runs with `doc_language=zh`
- **THEN** generated page titles, descriptions, headings, body text, and planning summaries SHALL default to Simplified Chinese

#### Scenario: English document language
- **WHEN** a wiki-generating step runs with `doc_language=en`
- **THEN** generated page titles, descriptions, headings, body text, and planning summaries SHALL default to English

#### Scenario: Source terminology preserved
- **WHEN** source material contains domain terms in another language
- **THEN** the generated wiki text SHALL preserve those terms when needed as quoted names or parenthetical terms
- **AND** the surrounding explanatory prose SHALL still follow `doc_language`
