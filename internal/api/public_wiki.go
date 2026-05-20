package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// PublicWikiListItem is the safe document summary exposed on public read-only routes.
type PublicWikiListItem struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Title      string `json:"title"`
	Path       string `json:"path"`
	FileType   string `json:"file_type"`
	PageCount  int64  `json:"page_count"`
	UpdatedAt  string `json:"updated_at"`
}

// PublicWikiDocument is the safe document payload for public read-only routes.
type PublicWikiDocument struct {
	ID        string   `json:"id"`
	Filename  string   `json:"filename"`
	Title     string   `json:"title"`
	Path      string   `json:"path"`
	FileType  string   `json:"file_type"`
	PageCount int64    `json:"page_count"`
	UpdatedAt string   `json:"updated_at"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags"`
}

// PublicWikiSearchResult is a safe search hit for public read-only routes.
type PublicWikiSearchResult struct {
	Content          string  `json:"content"`
	Page             int     `json:"page"`
	HeaderBreadcrumb string  `json:"header_breadcrumb"`
	ChunkIndex       int     `json:"chunk_index"`
	Filename         string  `json:"filename"`
	Title            string  `json:"title"`
	Path             string  `json:"path"`
	FileType         string  `json:"file_type"`
	Score            float64 `json:"score"`
}

func toPublicListItem(doc sqlite.Document) PublicWikiListItem {
	return PublicWikiListItem{
		ID:        doc.ID,
		Filename:  doc.Filename,
		Title:     doc.Title,
		Path:      doc.Path,
		FileType:  doc.FileType,
		PageCount: doc.PageCount,
		UpdatedAt: doc.UpdatedAt,
	}
}

func toPublicDocument(doc *sqlite.Document) PublicWikiDocument {
	tags := doc.Tags
	if tags == nil {
		tags = []string{}
	}
	return PublicWikiDocument{
		ID:        doc.ID,
		Filename:  doc.Filename,
		Title:     doc.Title,
		Path:      doc.Path,
		FileType:  doc.FileType,
		PageCount: doc.PageCount,
		UpdatedAt: doc.UpdatedAt,
		Content:   doc.Content,
		Tags:      tags,
	}
}

func toPublicSearchResult(chunk sqlite.SearchChunk) PublicWikiSearchResult {
	return PublicWikiSearchResult{
		Content:          chunk.Content,
		Page:             chunk.Page,
		HeaderBreadcrumb: chunk.HeaderBreadcrumb,
		ChunkIndex:       chunk.ChunkIndex,
		Filename:         chunk.Filename,
		Title:            chunk.Title,
		Path:             chunk.Path,
		FileType:         chunk.FileType,
		Score:            chunk.Score,
	}
}

func (a *API) requirePublicWiki(w http.ResponseWriter) bool {
	if !a.publicWikiEnabled {
		writeError(w, http.StatusForbidden, "public wiki access is disabled")
		return false
	}
	return true
}

// PublicWikiStatus reports whether public wiki read access is enabled.
func (a *API) PublicWikiStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": a.publicWikiEnabled})
}

// ListPublicWikiDocuments lists documents for the public wiki reader.
func (a *API) ListPublicWikiDocuments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !a.requirePublicWiki(w) {
		return
	}

	docs, err := a.db.ListDocuments()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	items := make([]PublicWikiListItem, 0, len(docs))
	for _, doc := range docs {
		items = append(items, toPublicListItem(doc))
	}
	writeJSON(w, http.StatusOK, items)
}

// GetPublicWikiDocument returns a single document for the public wiki reader.
func (a *API) GetPublicWikiDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !a.requirePublicWiki(w) {
		return
	}

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
	writeJSON(w, http.StatusOK, toPublicDocument(doc))
}

// SearchPublicWiki runs read-only search for the public wiki reader.
func (a *API) SearchPublicWiki(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !a.requirePublicWiki(w) {
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	limit := getIntQuery(r, "limit", 10)
	filter := r.URL.Query().Get("filter")

	results, err := a.db.SearchChunks(query, limit, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	publicResults := make([]PublicWikiSearchResult, 0, len(results))
	for _, chunk := range results {
		publicResults = append(publicResults, toPublicSearchResult(chunk))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":   query,
		"results": publicResults,
	})
}
