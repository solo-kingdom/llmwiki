---
name: llmwiki-ingest
description: Ingest source materials into the LLM Wiki. Use when the user wants to add knowledge from files, text, URLs, or conversations into the wiki.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Ingest source materials into the LLM Wiki — analyze, generate wiki pages, and update cross-references.

## When to Use

- User provides a file, text, or URL to ingest
- User says "add this to the wiki", "digest this", "ingest"
- User wants to update existing wiki pages with new information

## Prerequisites

- Run `/llmwiki-guide` first if this is your first interaction with the workspace
- Read `purpose.md` and `rules.md` to understand writing conventions

## Steps

1. **Understand the source material**
   - If a file: read its content
   - If a URL: fetch and extract text
   - If text: review for key entities, concepts, and relationships
   - If conversation: summarize key points to ingest

2. **Search for existing related pages** using MCP `search`:
   ```
   search(query="topic name", mode="search")
   ```
   Read any matching pages with `read` to avoid duplication.

3. **Plan what to create/update**
   - Identify entities, concepts, and relationships from the source
   - Determine page types (entity/concept/source/synthesis/comparison)
   - For existing pages: plan what to add (merge, not overwrite)

4. **Write wiki pages** using MCP `write`:
   ```
   write(path="wiki/entities/new-entity.md", content="...")
   ```
   
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

5. **Cross-reference**: Add `[[wikilinks]]` between related pages

6. **Verify**: Read back the written pages to confirm

## Page Type → Directory Mapping

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | `wiki/entities/` | People, orgs, products |
| concept | `wiki/concepts/` | Terms and ideas |
| source | `wiki/sources/` | Source file summaries |
| synthesis | `wiki/synthesis/` | Cross-source analysis |
| comparison | `wiki/comparisons/` | Comparative analysis |
| query | `wiki/queries/` | Archived Q&A |

## Merge Protection

When writing to an existing page, the system merges by default:
- **Locked fields**: `type`, `title`, `created` are never overwritten
- **Array fields**: `tags`, `sources`, `related` are union-merged (deduplicated)
- **Body**: LLM intelligently merges new content with existing body

## Guardrails

- ALWAYS search before writing to avoid duplicate pages
- Follow `purpose.md` scope — don't ingest topics outside the research domain
- Follow `rules.md` conventions — tone, citation style, language
- Every claim MUST trace back to a source or existing wiki page (no hallucination)
- Use `[[wikilinks]]` for internal references, not plain text names
- Keep `wiki/log.md` as append-only — never reorder or delete entries
- Never modify `raw/` directory contents
- Source summaries go in `wiki/sources/`, not in entity/concept pages directly

## Done Criteria

- [ ] All key entities and concepts from the source have wiki pages
- [ ] Cross-references (`[[wikilinks]]`) are added between related pages
- [ ] No duplicate pages created (checked via search)
- [ ] Frontmatter is complete (title, type, date, tags)
- [ ] Source summary page exists in `wiki/sources/` if ingesting from a file
