package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestKnowledgeGraphAPI(t *testing.T) {
	dir := t.TempDir()
	dbPath := dir + "/test.db"
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	pageA := &sqlite.Document{
		UserID: "u1", Filename: "a.md", Title: "Page A",
		Path: "/wiki/", RelativePath: "wiki/entities/a.md",
		SourceKind: "wiki", FileType: "md", Status: "ready",
	}
	pageB := &sqlite.Document{
		UserID: "u1", Filename: "b.md", Title: "Page B",
		Path: "/wiki/", RelativePath: "wiki/concepts/b.md",
		SourceKind: "wiki", FileType: "md", Status: "ready",
	}
	if err := db.CreateDocument(pageA); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateDocument(pageB); err != nil {
		t.Fatal(err)
	}
	if err := db.UpsertReference(pageA.ID, pageB.ID, "links_to", nil); err != nil {
		t.Fatal(err)
	}

	api := New(db)
	r := chi.NewRouter()
	r.Get("/api/v1/graph", api.KnowledgeGraph)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/graph", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}

	var resp sqlite.GraphData
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Nodes) != 2 {
		t.Fatalf("nodes = %d, want 2", len(resp.Nodes))
	}
	if len(resp.Edges) != 1 {
		t.Fatalf("edges = %d, want 1", len(resp.Edges))
	}

	nodeTypes := map[string]string{}
	for _, n := range resp.Nodes {
		nodeTypes[n.ID] = n.Type
		if n.DocumentID == "" {
			t.Fatalf("node %q missing document_id", n.ID)
		}
	}
	if nodeTypes["wiki/entities/a.md"] != "entity" {
		t.Fatalf("entity type = %q", nodeTypes["wiki/entities/a.md"])
	}
	if nodeTypes["wiki/concepts/b.md"] != "concept" {
		t.Fatalf("concept type = %q", nodeTypes["wiki/concepts/b.md"])
	}

	edge := resp.Edges[0]
	if edge.Source != "wiki/entities/a.md" || edge.Target != "wiki/concepts/b.md" {
		t.Fatalf("unexpected edge: %+v", edge)
	}
	if edge.Type != "links_to" {
		t.Fatalf("edge type = %q, want links_to", edge.Type)
	}
}

func TestKnowledgeGraphAPIEmpty(t *testing.T) {
	dir := t.TempDir()
	db, err := sqlite.Open(dir + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	api := New(db)
	r := chi.NewRouter()
	r.Get("/api/v1/graph", api.KnowledgeGraph)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/graph", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}

	var resp sqlite.GraphData
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Nodes == nil || resp.Edges == nil {
		t.Fatal("expected non-nil empty arrays")
	}
	if len(resp.Nodes) != 0 || len(resp.Edges) != 0 {
		t.Fatalf("expected empty graph, got nodes=%d edges=%d", len(resp.Nodes), len(resp.Edges))
	}
}
