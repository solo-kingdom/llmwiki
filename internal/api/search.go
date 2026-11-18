package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/store"
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

	mode := normalizeSearchMode(r.URL.Query().Get("mode"))
	if mode == "auto" {
		mode = "hybrid"
	}
	results, err := a.hybridSearch(query, limit, filter, pageTypes, mode)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []store.SearchChunk{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":   query,
		"mode":    mode,
		"results": results,
	})
}
