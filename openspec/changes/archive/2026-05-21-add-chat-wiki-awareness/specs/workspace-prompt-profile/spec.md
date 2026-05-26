## ADDED Requirements

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
