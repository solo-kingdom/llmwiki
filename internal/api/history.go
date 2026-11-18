package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/pmezard/go-difflib/difflib"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// ListHistory handles GET /api/v1/history.
func (a *API) ListHistory(w http.ResponseWriter, r *http.Request) {
	limit := getIntQuery(r, "limit", 50)
	before := strings.TrimSpace(r.URL.Query().Get("before"))
	sets, err := a.db.ListChangeSets(limit, before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sets == nil {
		sets = []store.ChangeSet{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"changes": sets})
}

// GetHistory handles GET /api/v1/history/{id}.
func (a *API) GetHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cs, err := a.db.GetChangeSet(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cs == nil {
		writeError(w, http.StatusNotFound, "change set not found")
		return
	}
	revs, err := a.db.ListChangeSetRevisions(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if revs == nil {
		revs = []store.PageRevision{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"change_set": cs, "pages": revs})
}

// HistoryDiff handles GET /api/v1/history/{id}/diff.
func (a *API) HistoryDiff(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cs, err := a.db.GetChangeSet(id)
	if err != nil || cs == nil {
		writeError(w, http.StatusNotFound, "change set not found")
		return
	}
	revs, err := a.db.ListChangeSetRevisions(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var b strings.Builder
	for _, rev := range revs {
		before := ""
		from := "/dev/null"
		if rev.ParentRevisionID != "" {
			parent, perr := a.db.GetRevision(rev.ParentRevisionID)
			if perr == nil && parent != nil {
				before = parent.Content
				from = "a/" + parent.RelativePath
			}
		}
		fromName := "a/" + rev.RelativePath
		if rev.ParentRevisionID != "" {
			if parent, perr := a.db.GetRevision(rev.ParentRevisionID); perr == nil && parent != nil {
				fromName = "a/" + parent.RelativePath
			}
		}
		diff, derr := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{
			A:        difflib.SplitLines(before),
			B:        difflib.SplitLines(rev.Content),
			FromFile: from,
			ToFile:   "b/" + rev.RelativePath,
			Context:  3,
		})
		if derr != nil {
			writeError(w, http.StatusInternalServerError, derr.Error())
			return
		}
		fmt.Fprintf(&b, "diff --git %s b/%s\n", fromName, rev.RelativePath)
		b.WriteString(diff)
	}
	writeJSON(w, http.StatusOK, map[string]string{"diff": b.String()})
}

// RollbackHistory handles POST /api/v1/history/{id}/rollback.
func (a *API) RollbackHistory(w http.ResponseWriter, r *http.Request) {
	a.enqueueRollback(w, chi.URLParam(r, "id"))
}

// IngestRollback handles POST /api/v1/ingest/rollback with {"change_set_id": "..."}.
func (a *API) IngestRollback(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChangeSetID string `json:"change_set_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	a.enqueueRollback(w, strings.TrimSpace(req.ChangeSetID))
}

func (a *API) enqueueRollback(w http.ResponseWriter, changeSetID string) {
	if changeSetID == "" {
		writeError(w, http.StatusBadRequest, "change_set_id is required")
		return
	}
	cs, err := a.db.GetChangeSet(changeSetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cs == nil {
		writeError(w, http.StatusNotFound, "change set not found")
		return
	}
	if existing, _ := a.db.GetIngestJobBySourceRef(changeSetID, "rollback"); existing != nil && existing.Status == "queued" {
		writeJSON(w, http.StatusAccepted, map[string]any{"status": "rollback_queued", "job_id": existing.ID})
		return
	}
	job := &store.IngestJob{
		InputType:  "rollback",
		SourcePath: "",
		SourceRef:  changeSetID,
		Status:     "queued",
		MaxRetries: 1,
	}
	if err := a.db.CreateIngestJob(job); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	activity.LogIngestJob(a.db, job, "queued", "api")
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "rollback_queued", "job_id": job.ID})
}

// PageHistory handles GET /api/v1/pages/history?path=wiki/x.md.
func (a *API) PageHistory(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(strings.TrimSpace(r.URL.Query().Get("path")), "/")
	if rel == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'path' is required")
		return
	}
	limit := getIntQuery(r, "limit", 100)
	revs, err := a.db.ListPageRevisions(rel, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if revs == nil {
		revs = []store.PageRevision{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": rel, "revisions": revs})
}

// GetRevision handles GET /api/v1/revisions/{id}.
func (a *API) GetRevision(w http.ResponseWriter, r *http.Request) {
	rev, err := a.db.GetRevision(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rev == nil {
		writeError(w, http.StatusNotFound, "revision not found")
		return
	}
	writeJSON(w, http.StatusOK, rev)
}

// RestoreRevision handles POST /api/v1/revisions/{id}/restore.
func (a *API) RestoreRevision(w http.ResponseWriter, r *http.Request) {
	cs, err := a.db.RestoreRevision(chi.URLParam(r, "id"), "api")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := ingest.RebuildDerived(a.db); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, cs)
}
