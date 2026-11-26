## Workflows

### New Wiki

1. `llmwiki init ~/research` → edit `purpose.md` with your research goals
2. Optional: edit `rules.md` to add domain rules and terminology
3. `llmwiki serve ~/research` → configure Provider and model
4. Start ingesting your first batch of materials on **Ingest**

### Continuous Ingestion (daily)

1. Open **Ingest** (Chat mode)
2. Chat to explore materials, or use **Add context** to paste notes/text
3. When satisfied, click **Archive** → review plan → confirm
4. Monitor execution on **Jobs**, read results on **Wiki**

### Periodic Maintenance (monthly)

1. Run Lint checks — prioritize error-level issues
2. Switch to Organize mode, describe your restructuring goals
3. AI diagnoses with audit + structure, then proposes optimizations
4. Confirm plan → archive to execute

### Deep Q&A

1. Switch to **QA** mode on **Ingest**
2. Ask specific questions → AI retrieves existing wiki content and synthesizes answers
3. Valuable answers can be archived to `wiki/queries/` as secondary knowledge sources
