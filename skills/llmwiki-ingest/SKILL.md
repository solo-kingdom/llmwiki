---
name: llmwiki-ingest
description: Ingest source materials into the LLM Wiki. Use when the user wants to add knowledge from files, text, URLs, or conversations into the wiki.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Ingest source materials into the LLM Wiki — analyze, generate wiki pages, and update cross-references.

This skill is the blueprint for ingest-related Go prompts, especially `StepAnalysis`, `StepGeneration`, `StepMergeBody`, and `StepRollback`. `skills/` distills workflows and constraints from external references; `internal/ingest/prompts.go` turns them into runtime prompts.

## When to Use

- User provides a file, text, or URL to ingest
- User says "add this to the wiki", "digest this", "ingest"
- User wants to update existing wiki pages with new information

## Prerequisites

- Run `/llmwiki-guide` first if this is your first interaction with the workspace
- Read `purpose.md` and `rules.md` to understand writing conventions
- Confirm the material is in scope for `purpose.md`; if not, tell the user first
- Check for private or sensitive information before ingesting; follow `rules.md` for retention or redaction policy

## Core Invariants

- `raw/` is read-only. Do not edit, move, or rewrite source files.
- The filesystem is the source of truth; SQLite/FTS5 is a rebuildable index.
- Every factual claim must trace back to source material or an existing wiki page.
- Before updating an existing page, `read` it and preserve existing information.
- `wiki/log.md` is append-only. Entries use `## [YYYY-MM-DD] action | description`.

## Steps

1. **Understand the source material**
   - If a file: read its content
   - If a URL: fetch and extract text
   - If text: review for key entities, concepts, and relationships
   - If conversation: summarize key points to ingest
   - If large: chunk it and keep each chunk tied to its source

2. **Search for existing related pages** using MCP `search`:
   ```
   search(query="topic name", mode="search")
   search(query="alias or English/Chinese variant", mode="search")
   ```
   Read matching pages with `read` to avoid duplication. For important entities or concepts, try aliases, abbreviations, and language variants.

3. **Plan what to create/update**
   - Identify entities, concepts, and relationships from the source
   - Determine page types (entity/concept/source/synthesis/comparison/query)
   - Create or update a `wiki/sources/` summary for the source material
   - For existing pages: list new facts, old facts to preserve, and cross-links to add

4. **Generate wiki pages** using runtime FILE blocks:
   ```
   ---FILE: wiki/entities/new-entity.md
   ...
   ---END FILE---
   ```
   If documenting MCP or external tooling, `write.path` is the target directory and the filename is generated from `title`; code prompts should primarily describe the FILE block protocol.
   
   Each page MUST have frontmatter:
   ```yaml
   ---
   title: Page Title
   type: entity
   date: 2026-05-29
   tags: [tag1, tag2]
   sources: [source-id]
   ---
   ```

   Note: generation prompts must not assume old pages can be overwritten. When updating an existing page, use `read` first and preserve old information while integrating new information in the FILE block.

5. **Cross-reference and cite evidence**
   - Add `[[wikilinks]]` between related pages
   - In source summary pages, list key claims, entities/concepts mentioned, and follow-ups
   - When adding facts to entity/concept pages, identify the source page or existing wiki page they came from
   - If facts conflict, preserve the conflict context instead of silently overwriting old claims

6. **Verify**
   - Read back written pages to confirm frontmatter, body, links, and sources
   - Run `search(query="", mode="lint")` to check links, frontmatter, and log format
   - If system or structure pages changed, confirm `wiki/index.md` / `wiki/log.md` still follow conventions

## Page Type → Directory Mapping

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | `wiki/entities/` | People, orgs, products |
| concept | `wiki/concepts/` | Terms and ideas |
| source | `wiki/sources/` | Source file summaries |
| synthesis | `wiki/synthesis/` | Cross-source analysis |
| comparison | `wiki/comparisons/` | Comparative analysis |
| query | `wiki/queries/` | Archived Q&A |

## Merge Strategy

The built-in ingest pipeline has three-layer merge protection: locked fields, array union, and LLM-assisted body merge. Prompts should still ask the model to generate merge-friendly content instead of relying on post-processing as a fallback:

- **Read old pages first**: load the target page and related pages with tools before updating.
- **Preserve identity fields**: do not casually change `type`, `title`, or `created`.
- **Merge arrays**: union and deduplicate `tags`, `sources`, and `related`.
- **Merge body content**: preserve old information, integrate new facts, and mark conflicts or open questions when uncertain.

## Guardrails

- ALWAYS search before writing to avoid duplicate pages
- Follow `purpose.md` scope — don't ingest topics outside the research domain
- Follow `rules.md` conventions — tone, citation style, language
- Every claim MUST trace back to a source or existing wiki page (no hallucination)
- Use `[[wikilinks]]` for internal references, not plain text names
- Keep `wiki/log.md` as append-only — never reorder or delete entries
- Never modify `raw/` directory contents
- Source summaries go in `wiki/sources/`, not in entity/concept pages directly
- In `StepPlan`, output only the plan JSON; only `StepGeneration` should output FILE blocks

## Done Criteria

- [ ] All key entities and concepts from the source have wiki pages
- [ ] Cross-references (`[[wikilinks]]`) are added between related pages
- [ ] No duplicate pages created (checked via search)
- [ ] Frontmatter is complete (title, type, date, tags)
- [ ] Source summary page exists in `wiki/sources/` if ingesting from a file
- [ ] Existing pages preserve prior information and prior sources
- [ ] Written pages were read back and lint was run; error-level issues are fixed
