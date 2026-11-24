import { TYPED_WIKI_SUBDIRS } from "./wiki_org.js";

export function workspaceLayoutSummary(): string {
  let output = "## Wiki Layout (canonical)\n\n";
  output += "Workspace root: `purpose.md`, `rules.md`, `raw/sources/`, `wiki/`\n\n";
  output += "Topic tree: business pages live in nested topic folders under `wiki/` (e.g. `wiki/AI工程/Agent/...`), with `type` in frontmatter (`entity|concept|synthesis|comparison|query|page`).\n";
  output += "Legacy flat dirs also supported: ";
  output += TYPED_WIKI_SUBDIRS.map((dir) => `wiki/${dir}/`).join(", ");
  output += "\n\nSystem pages: `wiki/overview.md`, `wiki/index.md`, `wiki/log.md`; hidden/system dirs: `wiki/sources/`, `wiki/templates/`\n";
  output += "Invalid: `wiki/purpose.md`, `wiki/raw/`, top-level business pages `wiki/*.md`, `wiki/skills/`\n";
  return output;
}
