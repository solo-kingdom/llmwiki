package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store"
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
	filter := store.ListDocumentsFilter{
		SourceKind:    r.URL.Query().Get("source_kind"),
		PageTypes:     r.URL.Query()["type"],
		ExcludeHidden: r.URL.Query().Get("exclude_hidden") == "true",
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
		docs = []store.Document{}
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

	// Path decides the document kind, matching reindex: wiki/ pages are wiki pages,
	// everything else is source material. Without this, agent-written wiki pages
	// would be indexed as sources until the next full reindex.
	relPath := strings.TrimPrefix(path.Join("/", req.Path, req.Filename), "/")
	sourceKind := "source"
	if strings.HasPrefix(relPath, "wiki/") {
		sourceKind = "wiki"
	}
	// Directory keeps the leading and trailing slash, matching what reindex stores.
	dir := path.Dir("/" + relPath)
	if !strings.HasSuffix(dir, "/") {
		dir += "/"
	}

	doc := &store.Document{
		Filename:     path.Base(relPath),
		Path:         dir,
		Content:      req.Content,
		Title:        req.Title,
		Tags:         req.Tags,
		Status:       "ready",
		SourceKind:   sourceKind,
		FileType:     strings.TrimPrefix(filepath.Ext(relPath), "."),
		RelativePath: relPath,
	}

	// Acquire page-level lock for same-page serialization
	if a.lockMgr != nil && doc.RelativePath != "" {
		a.lockMgr.Lock(doc.RelativePath)
		defer a.lockMgr.Unlock(doc.RelativePath)
	}

	if err := a.applyPageWrite("manual", "create page", doc, store.RevisionCreate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if saved, _ := a.db.GetDocument(doc.ID); saved != nil {
		doc = saved
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

	doc.Content = req.Content
	doc.ContentHash = contentHash(req.Content)
	if err := a.applyPageWrite("manual", "update page content", doc, store.RevisionUpdate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
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
	tags := existing.Tags
	if req.Tags != nil {
		tags = req.Tags
	}
	date := req.Date
	if date == "" {
		date = existing.Date
	}
	metadata := req.Metadata
	if metadata == "" {
		metadata = existing.Metadata
	}

	existing.Title = title
	existing.Tags = tags
	existing.Date = date
	existing.Metadata = metadata
	if err := a.applyPageWrite("manual", "update page metadata", existing, store.RevisionUpdate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
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

	doc, err := a.db.GetDocument(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if doc == nil {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}

	relPath := doc.RelativePath
	if relPath == "" && doc.Filename != "" {
		relPath = strings.TrimSuffix(doc.Path, "/") + "/" + doc.Filename
	}
	if err := a.applyPageDelete("manual", "delete page", relPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	activity.LogDocument(a.db, "deleted", id, relPath, "api")
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "path": strings.TrimPrefix(relPath, "/")})
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

	var relPaths []string
	for _, id := range req.IDs {
		doc, err := a.db.GetDocument(id)
		if err != nil || doc == nil {
			continue
		}
		rel := doc.RelativePath
		if rel == "" && doc.Filename != "" {
			rel = strings.TrimSuffix(doc.Path, "/") + "/" + doc.Filename
		}
		if rel != "" {
			relPaths = append(relPaths, rel)
		}
	}
	if err := a.applyPageDeletes("manual", "bulk delete", relPaths); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	n := int64(len(relPaths))
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
