package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

// Lint runs wiki health checks and returns a LintReport JSON payload.
func (a *API) Lint(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}

	report, err := engine.LintWorkspace(a.workspace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report.Issues == nil {
		report.Issues = []engine.LintIssue{}
	}
	writeJSON(w, http.StatusOK, report)
}
