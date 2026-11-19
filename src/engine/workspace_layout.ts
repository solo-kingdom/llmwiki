import { TYPED_WIKI_SUBDIRS } from "./wiki_org.js";

export function workspaceLayoutSummary(): string {
  let output = "## Wiki Layout (canonical)\n\n";
  output += "Workspace root: `purpose.md`, `rules.md`, `raw/sources/`, `wiki/`, `.llmwiki/index.db`\n\n";
  output += "Typed wiki subdirs (plural): ";
  output += TYPED_WIKI_SUBDIRS.map((dir) => `wiki/${dir}/`).join(", ");
  output += "\n\nSystem pages: `wiki/overview.md`, `wiki/index.md`, `wiki/log.md`; templates: `wiki/templates/`\n";
  output += "Invalid: `wiki/purpose.md`, `wiki/raw/`, singular `entity/`/`concept/`, `wiki/skills/`\n";
  return output;
}
