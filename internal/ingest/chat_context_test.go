package ingest

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestContextResolverSeedsFromWikiRefs(t *testing.T) {
	dir := t.TempDir()
	db, err := sqlite.Open(filepath.Join(dir, ".llmwiki", "index.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	doc := &sqlite.Document{
		Filename:     "seed.md",
		Title:        "Seed Page",
		Path:         "/wiki/",
		RelativePath: "wiki/concepts/seed.md",
		SourceKind:   "wiki",
		Status:       "ready",
		FileType:     "md",
		Content:      "seed content about attention",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatal(err)
	}

	resolver := &ContextResolver{DB: db, Workspace: dir}
	subset, err := resolver.ResolveRelatedSubset("attention", []WikiRefInput{{
		DocumentID:   doc.ID,
		RelativePath: doc.RelativePath,
		Title:        doc.Title,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(subset) == 0 {
		t.Fatal("expected non-empty subset")
	}
	if subset[0].RelativePath != doc.RelativePath {
		t.Fatalf("first = %q", subset[0].RelativePath)
	}
}

func TestFormatRelatedSubsetSection(t *testing.T) {
	section := FormatRelatedSubsetSection("zh", []RelatedSubsetEntry{
		{RelativePath: "wiki/a.md", Title: "A"},
	})
	if section == "" || !strings.Contains(section, "相关 wiki 子集") || !strings.Contains(section, "wiki/a.md") {
		t.Fatalf("section = %q", section)
	}
}
