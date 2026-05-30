package api

import (
	"net/http"
	"strconv"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// KnowledgeGraph returns wiki page nodes and links_to edges for visualization.
// Accepts optional "limit" query parameter (default 300, max 10000) to cap the
// number of nodes returned. Nodes are ranked by link count descending.
func (a *API) KnowledgeGraph(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		writeError(w, http.StatusInternalServerError, "database not configured")
		return
	}

	limit := 300
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
			if limit > 10000 {
				limit = 10000
			}
		}
	}

	data, err := a.db.BuildKnowledgeGraph(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if data.Nodes == nil {
		data.Nodes = []sqlite.GraphNode{}
	}
	if data.Edges == nil {
		data.Edges = []sqlite.GraphEdge{}
	}
	writeJSON(w, http.StatusOK, data)
}

func (a *API) Backlinks(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	refs, err := a.db.GetBacklinks(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if refs == nil {
		refs = []sqlite.ReferenceSummary{}
	}
	writeJSON(w, http.StatusOK, refs)
}

func (a *API) ForwardReferences(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing document id")
		return
	}

	refs, err := a.db.GetForwardReferences(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if refs == nil {
		refs = []sqlite.ReferenceSummary{}
	}
	writeJSON(w, http.StatusOK, refs)
}

func (a *API) UncitedSources(w http.ResponseWriter, r *http.Request) {
	sources, err := a.db.FindUncitedSources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sources == nil {
		sources = []sqlite.UncitedSource{}
	}
	writeJSON(w, http.StatusOK, sources)
}

func (a *API) StalePages(w http.ResponseWriter, r *http.Request) {
	pages, err := a.db.FindStalePages()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pages == nil {
		pages = []sqlite.StalePage{}
	}
	writeJSON(w, http.StatusOK, pages)
}
