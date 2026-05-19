package api

import (
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

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
