package api

import (
	"encoding/json"
	"net/http"
	"strings"

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

// UpdateWorkspaceRuleFiles writes purpose.md and/or rules.md. A missing field keeps the file as is.
func (a *API) UpdateWorkspaceRuleFiles(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusServiceUnavailable, "workspace not configured")
		return
	}

	var req struct {
		Purpose *string `json:"purpose"`
		Rules   *string `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Purpose == nil && req.Rules == nil {
		writeError(w, http.StatusBadRequest, "purpose or rules is required")
		return
	}

	written := []string{}
	for _, f := range []struct {
		rel     string
		content *string
	}{{"purpose.md", req.Purpose}, {"rules.md", req.Rules}} {
		if f.content == nil {
			continue
		}
		if strings.TrimSpace(*f.content) == "" {
			writeError(w, http.StatusBadRequest, f.rel+": content must not be empty")
			return
		}
		if err := a.writeFileFirst(f.rel, *f.content); err != nil {
			writeError(w, http.StatusInternalServerError, "file write failed: "+err.Error())
			return
		}
		a.indexDocumentRelPath(f.rel)
		written = append(written, f.rel)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "written": written})
}
