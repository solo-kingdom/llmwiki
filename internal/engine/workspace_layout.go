package engine

import "strings"

// WorkspaceLayoutSummary returns a short markdown summary of the canonical workspace layout.
func WorkspaceLayoutSummary() string {
	var sb strings.Builder
	sb.WriteString("## Wiki Layout (canonical)\n\n")
	sb.WriteString("Workspace root: `purpose.md`, `rules.md`, `raw/sources/`, `wiki/`, `.llmwiki/index.db`\n\n")
	sb.WriteString("Typed wiki subdirs (plural): ")
	dirs := make([]string, 0, len(TypedWikiSubdirs))
	for _, d := range TypedWikiSubdirs {
		dirs = append(dirs, "wiki/"+d+"/")
	}
	sb.WriteString(strings.Join(dirs, ", "))
	sb.WriteString("\n\nSystem pages: `wiki/overview.md`, `wiki/index.md`, `wiki/log.md`; templates: `wiki/templates/`\n")
	sb.WriteString("Invalid: `wiki/purpose.md`, `wiki/raw/`, singular `entity/`/`concept/`, `wiki/skills/`\n")
	return sb.String()
}
