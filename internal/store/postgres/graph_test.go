package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestBuildKnowledgeGraph(t *testing.T) {
	db := pgtest.Open(t)
	a := seedPGDoc(t, db, "", "a.md", "/wiki/entities", "wiki/entities/a.md", "wiki")
	b := seedPGDoc(t, db, "", "b.md", "/wiki/entities", "wiki/entities/b.md", "wiki")
	c := seedPGDoc(t, db, "", "c.md", "/wiki/concepts", "wiki/concepts/c.md", "wiki")
	hidden := seedPGDoc(t, db, "", "t.md", "/wiki/templates", "wiki/templates/t.md", "wiki")
	seedPGDoc(t, db, "", "paper.pdf", "/sources", "sources/paper.pdf", "source")

	for _, edge := range []struct{ from, to string }{
		{a.ID, b.ID},
		{b.ID, c.ID},
		{a.ID, hidden.ID},
	} {
		if err := db.UpsertReference(edge.from, edge.to, "links_to", nil); err != nil {
			t.Fatalf("UpsertReference: %v", err)
		}
	}

	graph, err := db.BuildKnowledgeGraph(0)
	if err != nil {
		t.Fatalf("BuildKnowledgeGraph: %v", err)
	}
	if graph.TotalNodes != 3 {
		t.Errorf("TotalNodes = %d, want 3", graph.TotalNodes)
	}
	if graph.Truncated {
		t.Error("Truncated = true, want false")
	}
	if len(graph.Nodes) != 3 {
		t.Fatalf("nodes = %+v, want 3", graph.Nodes)
	}
	if len(graph.Edges) != 2 {
		t.Fatalf("edges = %+v, want 2", graph.Edges)
	}
	for _, n := range graph.Nodes {
		if n.ID == "wiki/templates/t.md" {
			t.Error("hidden template node leaked into graph")
		}
	}
	types := map[string]string{}
	for _, n := range graph.Nodes {
		types[n.ID] = n.Type
	}
	if types["wiki/entities/a.md"] != "entity" || types["wiki/concepts/c.md"] != "concept" {
		t.Errorf("node types = %v", types)
	}

	limited, err := db.BuildKnowledgeGraph(2)
	if err != nil {
		t.Fatalf("BuildKnowledgeGraph(2): %v", err)
	}
	if limited.TotalNodes != 3 || !limited.Truncated {
		t.Errorf("limited totals = %d, truncated=%v; want 3, true", limited.TotalNodes, limited.Truncated)
	}
	if len(limited.Nodes) != 2 {
		t.Fatalf("limited nodes = %+v, want 2", limited.Nodes)
	}
	if len(limited.Edges) != 1 || limited.Edges[0].Target != "wiki/entities/b.md" {
		t.Fatalf("limited edges = %+v, want only a->b", limited.Edges)
	}

	all, err := db.BuildKnowledgeGraph(10)
	if err != nil {
		t.Fatalf("BuildKnowledgeGraph(10): %v", err)
	}
	if all.Truncated || len(all.Nodes) != 3 {
		t.Errorf("large limit = %+v, want no truncation and 3 nodes", all)
	}
}

func TestBuildKnowledgeGraphExcludesSoftDeleted(t *testing.T) {
	db := pgtest.Open(t)
	a := seedPGDoc(t, db, "", "a.md", "/wiki", "wiki/a.md", "wiki")
	b := seedPGDoc(t, db, "", "b.md", "/wiki", "wiki/b.md", "wiki")

	if err := db.UpsertReference(a.ID, b.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}
	if _, err := db.ArchiveDocuments([]string{b.ID}); err != nil {
		t.Fatalf("ArchiveDocuments: %v", err)
	}

	graph, err := db.BuildKnowledgeGraph(0)
	if err != nil {
		t.Fatalf("BuildKnowledgeGraph: %v", err)
	}
	if graph.TotalNodes != 1 || len(graph.Nodes) != 1 || graph.Nodes[0].DocumentID != a.ID {
		t.Fatalf("graph after archive = %+v, want only a", graph)
	}
	if len(graph.Edges) != 0 {
		t.Errorf("edges after archive = %+v, want none", graph.Edges)
	}
}

func TestListWikiGraphEdges(t *testing.T) {
	db := pgtest.Open(t)
	a := seedPGDoc(t, db, "", "a.md", "/wiki", "wiki/a.md", "wiki")
	b := seedPGDoc(t, db, "", "b.md", "/wiki", "wiki/b.md", "wiki")
	src := seedPGDoc(t, db, "", "src.pdf", "/sources", "sources/src.pdf", "source")

	if err := db.UpsertReference(a.ID, b.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}
	if err := db.UpsertReference(a.ID, src.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference cites: %v", err)
	}

	edges, err := db.ListWikiGraphEdges()
	if err != nil {
		t.Fatalf("ListWikiGraphEdges: %v", err)
	}
	if len(edges) != 1 {
		t.Fatalf("edges = %+v, want 1 links_to wiki edge", edges)
	}
	if edges[0].Source != "wiki/a.md" || edges[0].Target != "wiki/b.md" || edges[0].Type != "links_to" {
		t.Errorf("edge = %+v", edges[0])
	}
}
