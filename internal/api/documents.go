package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type createDocumentRequest struct {
	Filename string   `json:"filename"`
	Path     string   `json:"path"`
	Content  string   `json:"content"`
	Title    string   `json:"title"`
	Tags     []string `json:"tags"`
}

type updateContentRequest struct {
	Content string `json:"content"`
}

type updateMetadataRequest struct {
	Title    string   `json:"title"`
	Tags     []string `json:"tags"`
	Date     string   `json:"date"`
	Metadata string   `json:"metadata"`
}

type bulkDeleteRequest struct {
	IDs []string `json:"ids"`
}

func (a *API) ListDocuments(w http.ResponseWriter, r *http.Request) {
	filter := sqlite.ListDocumentsFilter{
		SourceKind: r.URL.Query().Get("source_kind"),
		PageTypes:  r.URL.Query()["type"],
	}
	if len(r.URL.Query()["types"]) > 0 {
		filter.PageTypes = r.URL.Query()["types"]
	}
	docs, err := a.db.ListDocumentsFiltered(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if docs == nil {
		docs = []sqlite.Document{}
	}
	writeJSON(w, http.StatusOK, docs)
}

func (a *API) GetDocument(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	doc, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc == nil {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (a *API) GetDocumentContent(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	doc, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc == nil {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": doc.Content})
}

func (a *API) CreateDocument(w http.ResponseWriter, r *http.Request) {
	var req createDocumentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Filename == "" {
		writeError(w, http.StatusBadRequest, "filename is required")
		return
	}

	doc := &sqlite.Document{
		Filename:     req.Filename,
		Path:         req.Path,
		Content:      req.Content,
		Title:        req.Title,
		Tags:         req.Tags,
		Status:       "ready",
		SourceKind:   "source",
		FileType:     "md",
		RelativePath: req.Path + "/" + req.Filename,
	}

	// Acquire page-level lock for same-page serialization
	if a.lockMgr != nil && doc.RelativePath != "" {
		a.lockMgr.Lock(doc.RelativePath)
		defer a.lockMgr.Unlock(doc.RelativePath)
	}

	// FILE-FIRST: Write canonical content to filesystem before DB insert
	if doc.RelativePath != "" && doc.Content != "" {
		if err := a.writeFileFirst(doc.RelativePath, doc.Content); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("file write failed: %v", err))
			return
		}
	}

	if err := a.db.CreateDocument(doc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc.RelativePath != "" {
		a.indexDocumentRelPath(doc.RelativePath)
	} else {
		a.indexDocumentContent(doc.ID, doc.Content)
	}
	activity.LogDocument(a.db, "created", doc.ID, doc.RelativePath, "api")
	writeJSON(w, http.StatusCreated, doc)
}

func (a *API) UpdateDocumentContent(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	var req updateContentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch existing doc to get file path
	doc, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc == nil {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}

	// Acquire page-level lock for same-page serialization
	if a.lockMgr != nil && doc.RelativePath != "" {
		a.lockMgr.Lock(doc.RelativePath)
		defer a.lockMgr.Unlock(doc.RelativePath)
	}

	// FILE-FIRST: Write canonical content to filesystem before DB update
	if doc.RelativePath != "" {
		if err := a.writeFileFirst(doc.RelativePath, req.Content); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("file write failed: %v", err))
			return
		}
	}

	// Now update the DB index (derived data)
	if err := a.db.UpdateDocument(id, req.Content, "", nil, "", ""); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if doc.RelativePath != "" {
		a.indexDocumentRelPath(doc.RelativePath)
	} else {
		a.indexDocumentContent(id, req.Content)
	}

	updated, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	activity.LogDocument(a.db, "updated", id, doc.RelativePath, "api")
	writeJSON(w, http.StatusOK, updated)
}

func (a *API) UpdateDocumentMetadata(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	var req updateMetadataRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	existing, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}

	title := req.Title
	if title == "" {
		title = existing.Title
	}
	tags := req.Tags
	date := req.Date
	metadata := req.Metadata

	if err := a.db.UpdateDocument(id, existing.Content, title, tags, date, metadata); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if existing.RelativePath != "" {
		a.indexDocumentRelPath(existing.RelativePath)
	} else {
		a.indexDocumentContent(id, existing.Content)
	}

	doc, _ := a.db.GetDocument(id)
	activity.LogDocument(a.db, "updated", id, existing.RelativePath, "api")
	writeJSON(w, http.StatusOK, doc)
}

func (a *API) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	n, err := a.db.ArchiveDocuments([]string{id})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	activity.LogDocument(a.db, "deleted", id, "", "api")
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *API) BulkDeleteDocuments(w http.ResponseWriter, r *http.Request) {
	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids array is required")
		return
	}

	n, err := a.db.ArchiveDocuments(req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	activity.Record(a.db, activity.Entry{
		Level:    "info",
		Category: "document",
		Action:   "bulk_deleted",
		Message:  fmt.Sprintf("批量删除 %d 个文档", n),
		Source:   "api",
		Details: map[string]interface{}{
			"deleted_count": n,
			"ids":           req.IDs,
		},
	})
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": n})
}
