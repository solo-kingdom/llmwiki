---
name: llmwiki-query
description: Query and reorganize the LLM Wiki. Use when the user asks questions about the wiki's content, or wants to restructure, merge, or optimize the wiki.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Query existing wiki knowledge or reorganize the wiki structure.

This skill is the blueprint for query and organization Go prompts, especially `StepSessionQA`, `StepPlanQA`, `StepSessionOrganize`, and `StepPlanOrganize`. `skills/` distills workflows from external references; `internal/ingest/prompts.go` implements them at runtime.

## When to Use

- User asks a question about topics in the wiki
- User says "what do we know about X?", "how are X and Y related?"
- User wants to restructure, merge, or reorganize pages
- User says "clean up the wiki", "merge duplicates", "reorganize"

## Core Invariants

- Answers must be grounded in existing wiki pages, source summaries, or material provided in the current turn.
- If evidence is missing, say the wiki does not cover it yet; do not invent facts.
- Read pages before reorganizing; after merging or moving, verify links and frontmatter.
- `raw/` is read-only. `wiki/log.md` is append-only and uses `## [YYYY-MM-DD] action | description`.

## Two Modes

### QA Mode (Answer Questions)

1. **Search** for relevant pages:
   ```
   search(query="topic", mode="search")
   search(query="alias / abbreviation / English or Chinese variant", mode="search")
   ```
   If the first search returns nothing, broaden or vary the terms. FTS5 recall for CJK content can depend on tokenizer behavior, so do not rely on one exact search.

2. **Read** the most relevant pages:
   ```
   read(path="wiki/entities/topic.md")
   ```

3. **Inspect references**:
   ```
   search(query="document-id", mode="references")
   ```
   `references` currently queries by document ID; if the current context does not expose an ID, prompts should allow the model to use `search` / `read` instead. In Local tools contexts, use `references(query="document-id")`.

4. **Synthesize** an answer grounded in wiki content
   - Cite specific pages: "According to [[Entity Name]]..."
   - If the wiki doesn't cover it fully, say so explicitly
   - Optionally suggest creating a new page for the gap
   - If pages conflict, list the conflicting sources and uncertainty

5. **Archive** valuable Q&A (if user wants):
   ```
   StepPlanQA → plan JSON → StepGeneration → FILE block under wiki/queries/
   ```
   Before archiving, state that it will be written to `wiki/queries/`. Planning steps produce plans only; generation steps write FILE blocks.

### Organize Mode (Restructure)

1. **Get directory structure** and **audit health**:
   ```
   search(query="", mode="list")    → all pages
   search(query="", mode="lint")    → health check
   ```
   Runtime organize prompts should prefer:
   ```
   structure()  → directory tree, page counts, empty directories
   audit()      → dead links, orphan pages, metadata, statistics
   gaps()       → missing pages or uncited sources
   similar()    → similar page candidates
   references() → link graph
   ```

2. **Identify issues**:
   - Duplicate or highly similar pages
   - Orphan pages (no incoming links)
   - Misplaced pages (wrong directory)
   - Missing cross-references
   - Dead links

3. **Plan reorganization**:
   - Which pages to merge
   - Which to move/rename
   - What new cross-references to add
   - What gaps to fill

4. **Plan or execute changes**
   - `read` all affected pages before updating
   - Before deleting, confirm the page is not a system page and not the only page carrying a source's information
   - Treat `overview.md`, `index.md`, and `log.md` as system pages, not ordinary deletion targets
   - `StepPlanOrganize` outputs plan JSON only; after confirmation, `StepGeneration` outputs FILE blocks

5. **Verify** the restructured wiki passes lint checks

## Search Tips

- Use specific entity/concept names for best results
- The search uses SQLite FTS5 — supports phrase queries (`"exact phrase"`)
- If first search returns nothing, try synonyms, aliases, casing, English/Chinese variants, or broader queries
- For Chinese, Japanese, and other CJK content, do not assume tokenization is always ideal; use shorter terms, keyword combinations, page listing, and references as backup

## Guardrails

- Answers MUST be grounded in existing wiki content — never fabricate facts
- If the wiki doesn't contain relevant info, say "The wiki does not yet cover this topic"
- When reorganizing, always read pages before merging — understand what you're combining
- Never delete `wiki/overview.md`, `wiki/index.md`, or `wiki/log.md`
- When merging pages, preserve all unique information from both sources
- Keep frontmatter consistent after reorganization
- Log major structural changes in the conversation for user awareness
- Session steps answer, diagnose, and plan only; archive confirmation moves the workflow into plan/generation steps

## Done Criteria

### QA Mode
- [ ] Searched thoroughly for relevant pages
- [ ] Read and understood the relevant content
- [ ] Answer is grounded in wiki content with citations
- [ ] Acknowledged any gaps in wiki coverage
- [ ] If Q&A was archived, it was written to `wiki/queries/` and read back

### Organize Mode
- [ ] Audited wiki health (lint check)
- [ ] Identified all structural issues
- [ ] Executed reorganization plan
- [ ] Verified no dead links or broken references after changes
- [ ] All pages have correct frontmatter after moves/merges
- [ ] Major structural changes were explained to the user, and index/log updates were considered when needed
