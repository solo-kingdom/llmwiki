package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func (a *API) Search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	limit := getIntQuery(r, "limit", 10)
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "wiki"
	}
	pageTypes := r.URL.Query()["types"]

	results, err := a.db.SearchChunks(query, limit, filter, pageTypes...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []sqlite.SearchChunk{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":   query,
		"results": results,
	})
}
