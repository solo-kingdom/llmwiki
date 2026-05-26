# V1 Architecture Constraints — Acceptance Checklist

This document maps each capability spec to executable verification steps.

## 1. Single-Process Service Topology

### Spec: `single-process-service-topology`

- [x] **Service boot composition**: `llmwiki serve` initializes API, Web UI, MCP RPC, and watcher in one process
  - Verify: `go test ./cmd/llmwiki/ -run TestBuild` (compiles)
  - Verify: `go test ./internal/server/` (server tests)
  - Manual: Start `llmwiki serve`, verify all endpoints respond

- [x] **Shared dependency context**: API and MCP handlers share same DB and lock manager
  - Verify: `go test ./internal/server/` (server.New creates shared context)

- [x] **Runtime mode declaration**: Health endpoint exposes enabled subcomponents
  - Verify: `curl http://localhost:8868/api/v1/health` returns mode flags
  - Verify: `go test ./internal/server/ -v` (health endpoint test)

## 2. MCP RPC Access Model

### Spec: `mcp-rpc-access-model`

- [x] **RPC-first MCP exposure**: MCP tools accessible via HTTP POST at `/mcp`
  - Verify: `go test ./internal/mcp/ -v -run TestRPCContract`
  - Verify: `curl -X POST http://localhost:8868/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'`

- [x] **No default stdio dependency**: Release does not gate on Claude Desktop stdio
  - Verify: `grep -r "stdio" internal/mcp/` shows only legacy stdio code
  - Verify: Health endpoint includes `mcp_access_model: rpc-first`

- [x] **Explicit compatibility statement**: Capabilities and docs state RPC-first
  - Verify: `curl http://localhost:8868/api/v1/health` includes compatibility message
  - Verify: README.md includes "MCP RPC-First Compatibility" section

## 3. Truth Data Persistence Boundary

### Spec: `truth-data-persistence-boundary`

- [x] **File-first truth persistence**: Wiki content written to disk before DB update
  - Verify: `go test ./internal/api/ -v -run TestUpdateDocumentContent`
  - Verify: Code in `internal/api/filewrite.go` writes file before DB

- [x] **Derived-only database policy**: SQLite stores only rebuildable data
  - Verify: `go test ./internal/engine/ -v -run TestReindex` (rebuild from files)
  - Verify: Schema comments in `internal/store/sqlite/schema.sql` classify fields

- [x] **Cache non-authoritativeness**: DB cache can diverge, files prevail on reindex
  - Verify: `go test ./internal/engine/ -v` (reindex verification)
  - Verify: `engine/dataaudit.go` classifies fields

## 4. Ingest Concurrency Control

### Spec: `ingest-concurrency-control`

- [x] **Cross-file concurrent ingest**: Different files can be ingested in parallel
  - Verify: `go test ./internal/ingest/ -v -run TestPageLockManagerCrossFileParallelism`

- [x] **Same-page serialization**: Page-level mutex prevents concurrent same-page writes
  - Verify: `go test ./internal/ingest/ -v -run TestPageLockManagerSamePageContention`
  - Verify: Lock applied in `internal/api/documents.go` UpdateDocumentContent

- [x] **Lock scope visibility**: Lock wait/hold metrics logged when threshold exceeded
  - Verify: `go test ./internal/ingest/ -v -run TestPageLockManagerStats`

## 5. Reference Graph Transactional Update

### Spec: `reference-graph-transactional-update`

- [x] **Transactional reference update**: Delete + insert in single transaction
  - Verify: `go test ./internal/store/sqlite/ -v -run TestReplaceReferencesInTxAtomic`

- [x] **Idempotent edge upsert**: INSERT OR REPLACE with unique constraint
  - Verify: `go test ./internal/store/sqlite/ -v -run TestUpsertReferenceIdempotent`
  - Verify: `go test ./internal/store/sqlite/ -v -run TestReplaceReferencesInTxIdempotent`

- [x] **Failure rollback**: Partial changes rolled back on error
  - Verify: `go test ./internal/store/sqlite/ -v -run TestReplaceReferencesInTxRollbackOnInvalidTarget`

## 6. Tiered Source Processing V1

### Spec: `tiered-source-processing-v1`

- [x] **Tiered capability**: A/B/C tiers implemented in SourceProcessor
  - Verify: `go test ./internal/engine/ -v -run TestSourceProcessor`

- [x] **Optional system dependency**: pdftotext/libreoffice not required for startup
  - Verify: `go test ./internal/engine/ -v` (SourceProcessor.GetCapabilities())

- [x] **Degradation observability**: API returns missing deps and remediation hints
  - Verify: `curl http://localhost:8868/api/v1/capabilities` returns tier status

- [x] **Forward enhancement declaration**: Post-v1 roadmap documented
  - Verify: `docs/07-source-processing-roadmap.md` exists

## 7. LLM Configuration Management

### Spec: `llm-config-management`

- [x] **UI-first configuration**: Web UI config persisted to `.llmwiki/config.json`
  - Verify: `go test ./internal/llm/ -v -run TestConfigManagerReload`

- [x] **Environment variable fallback**: Env vars used when UI config absent
  - Verify: `go test ./internal/llm/ -v -run TestLoadConfigEnvFallback`

- [x] **Configurable timeout policy**: Request and stream idle timeouts configurable
  - Verify: `go test ./internal/llm/ -v -run TestProviderExtensibility_TimeoutConfigurable`

- [x] **Provider extensibility**: New providers via config, no startup flag changes
  - Verify: `go test ./internal/llm/ -v -run TestProviderExtensibility_NewProviderViaConfig`
  - Verify: `go test ./internal/llm/ -v -run TestProviderExtensibility_ConfigChangeWithoutRestart`
