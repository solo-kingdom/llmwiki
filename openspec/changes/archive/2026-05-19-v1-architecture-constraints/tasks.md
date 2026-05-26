## 1. Service Topology & MCP RPC Realignment

- [x] 1.1 Refactor startup flow so `llmwiki serve` initializes API + Web + MCP RPC endpoints in a single process context
- [x] 1.2 Remove/disable stdio-first MCP assumption in runtime path and document RPC-first behavior in capabilities/health metadata
- [x] 1.3 Add RPC MCP endpoint contract tests for `initialize`, `tools/list`, and `tools/call`

## 2. Truth Data Boundary Enforcement

- [x] 2.1 Audit persistence paths and classify fields into canonical file truth vs rebuildable DB-derived data
- [x] 2.2 Enforce file-first write ordering for canonical wiki/source updates before derived index refresh
- [x] 2.3 Implement reindex verification checks that recover frontmatter metadata + references from files after DB reset

## 3. Concurrency Control Hardening

- [x] 3.1 Introduce page-level mutex manager keyed by normalized page path
- [x] 3.2 Apply lock manager to write/ingest merge paths to guarantee same-page serialization
- [x] 3.3 Add concurrent ingest tests covering cross-file parallelism and same-page contention behavior

## 4. Transactional Reference Graph Updates

- [x] 4.1 Refactor reference graph refresh into an explicit DB transaction boundary
- [x] 4.2 Enforce idempotent upsert path using unique constraints and retry-safe operations
- [x] 4.3 Add rollback tests for partial failure during reference update to verify atomicity

## 5. Tiered PDF/Office Source Processing (V1)

- [x] 5.1 Implement source processing tier selector (built-in, optional system dependency, degraded fallback)
- [x] 5.2 Add dependency probe and runtime capability reporting in API/log output
- [x] 5.3 Implement structured fallback responses with missing dependency reason + remediation hints
- [x] 5.4 Document post-v1 enhancement path for higher-fidelity parsing/OCR

## 6. LLM Configuration Governance

- [x] 6.1 Implement UI-backed LLM config persistence and runtime reload path
- [x] 6.2 Implement environment variable fallback resolution when UI config values are absent
- [x] 6.3 Make timeout policy configurable via persisted config (request timeout, streaming idle timeout)
- [x] 6.4 Add compatibility tests for adding new provider config schemas without startup flag changes

## 7. Documentation & Acceptance Gate

- [x] 7.1 Update README/architecture docs with clarified first-release MCP compatibility scope (RPC-first, no stdio gate)
- [x] 7.2 Add acceptance checklist mapping each new capability spec to executable verification steps
- [x] 7.3 Run final spec-to-implementation trace review and close open questions that block apply
