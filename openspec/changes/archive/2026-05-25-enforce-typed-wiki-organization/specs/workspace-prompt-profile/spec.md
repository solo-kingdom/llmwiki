## MODIFIED Requirements

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

## ADDED Requirements

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
