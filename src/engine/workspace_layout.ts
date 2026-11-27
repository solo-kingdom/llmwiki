import { TYPED_WIKI_SUBDIRS } from "./wiki_org.js";

export function workspaceLayoutSummary(): string {
  let output = "## Wiki Layout (PostgreSQL SSOT)\n\n";
  output += "Storage: PostgreSQL is the single source of truth for wiki pages, folders, revisions (`change_sets`), and raw `archives`.\n\n";
  output += "Topic tree: business pages live in nested lowercase kebab-case topic folders under `wiki/` (e.g. `wiki/ai-agent/agent-runtime/...`), with `type` in frontmatter (`entity|concept|synthesis|comparison|query|experience|ledger|page`).\n";
  output += "Legacy flat dirs also supported for existing content: ";
  output += TYPED_WIKI_SUBDIRS.map((dir) => `wiki/${dir}/`).join(", ");
  output += "\n\nPyramid navigation pages: `wiki/overview.md` and per-folder `_overview.md` (DB-maintained).\n";
  output += "Invalid: `wiki/purpose.md`, `wiki/raw/`, top-level business pages `wiki/*.md`, `wiki/skills/`\n";
  return output;
}
