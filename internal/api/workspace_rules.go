package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
)

// GetWorkspaceRuleFiles returns truncated previews of purpose.md and rules.md.
func (a *API) GetWorkspaceRuleFiles(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusServiceUnavailable, "workspace not configured")
		return
	}
	writeJSON(w, http.StatusOK, ingest.LoadRuleFilesPreview(a.workspace))
}
