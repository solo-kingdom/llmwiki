package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// KnowledgeGraph returns wiki page nodes and links_to edges for visualization.
func (a *API) KnowledgeGraph(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		writeError(w, http.StatusInternalServerError, "database not configured")
		return
	}

	data, err := a.db.BuildKnowledgeGraph()
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
