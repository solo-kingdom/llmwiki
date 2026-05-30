## ADDED Requirements

### Requirement: Organize session structure fidelity
When the ingest session mode is `organize`, the session chat LLM SHALL treat Local diagnostic tool results as the authoritative wiki structure. The model SHALL NOT present a wiki directory tree in its assistant reply unless it is derived from the `structure` tool return in the same conversation turn chain.

#### Scenario: Structure tool called before structural recommendations
- **WHEN** the user starts an organize mode session chat turn requesting wiki restructuring
- **THEN** the tool loop SHALL call the `structure` tool before the final assistant reply
- **AND** round 0 SHALL enforce at least one tool call per existing organize tool-choice rules

#### Scenario: Assistant must not fabricate directory trees
- **WHEN** the assistant reply includes a wiki directory listing or tree
- **THEN** the listing SHALL match paths and counts from the latest `structure` tool result in the conversation
- **AND** SHALL NOT include directories outside the typed wiki contract (e.g. `wiki/skills/`, `wiki/raw/`, singular `entity/`)

#### Scenario: Organize nudge on missing tools
- **WHEN** organize mode round 0 completes without tool calls and the system retries with a nudge
- **THEN** the nudge message SHALL instruct the model to call `structure` and `audit` before answering
- **AND** SHALL instruct the model to quote tool output when presenting directory structure

### Requirement: Organize session tool set includes structure
Organize mode session chat SHALL expose the `structure` Local diagnostic tool to the model alongside existing organize diagnostics.

#### Scenario: Structure tool available in organize mode
- **WHEN** session mode is `organize` and the chat tool loop assembles available tools
- **THEN** `structure` SHALL be included in the tool list passed to the LLM
