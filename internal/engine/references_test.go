package engine

import (
	"testing"
)

func TestParseCitations(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "doc1", Filename: "paper.pdf", Path: "/sources"},
		{ID: "doc2", Filename: "book.epub", Path: "/sources"},
	}
	rp := NewReferenceParser(docs)

	content := `Some text here.

[^1]: paper.pdf, p.3

[^2]: book.epub`

	refs := rp.ParseReferences(content, "/wiki/test.md")
	if len(refs) < 2 {
		t.Fatalf("expected at least 2 references, got %d", len(refs))
	}

	// Find the citation
	var citeRef *Reference
	for i := range refs {
		if refs[i].RefType == "cites" {
			citeRef = &refs[i]
			break
		}
	}
	if citeRef == nil {
		t.Fatal("expected a cites reference")
	}
	if citeRef.TargetPath != "doc1" {
		t.Errorf("expected TargetPath='doc1', got %q", citeRef.TargetPath)
	}
	if citeRef.Page == nil || *citeRef.Page != 3 {
		t.Errorf("expected Page=3, got %v", citeRef.Page)
	}
}

func TestParseWikiLinks(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "doc1", Filename: "attention.md", Path: "/wiki/concepts"},
		{ID: "doc2", Filename: "transformers.md", Path: "/wiki/concepts"},
	}
	rp := NewReferenceParser(docs)

	content := `See [Attention Mechanism](attention.md) for details.
Also check [Transformers](transformers.md).`

	refs := rp.ParseReferences(content, "/wiki/concepts/overview.md")
	if len(refs) != 2 {
		t.Fatalf("expected 2 references, got %d", len(refs))
	}

	for _, r := range refs {
		if r.RefType != "links_to" {
			t.Errorf("expected links_to, got %q", r.RefType)
		}
		if r.TargetPath != "doc1" && r.TargetPath != "doc2" {
			t.Errorf("unexpected TargetPath: %q", r.TargetPath)
		}
	}
}

func TestParseWikiLinksSkipExternal(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "doc1", Filename: "page.md", Path: "/wiki"},
	}
	rp := NewReferenceParser(docs)

	content := `[External](https://example.com)
[Local](page.md)
[Image](photo.png)
[Email](mailto:test@test.com)
[Anchor](#section)`

	refs := rp.ParseReferences(content, "/wiki/test.md")
	// Should only have the local page link
	if len(refs) != 1 {
		t.Fatalf("expected 1 reference (local only), got %d", len(refs))
	}
	if refs[0].TargetPath != "doc1" {
		t.Errorf("expected TargetPath='doc1', got %q", refs[0].TargetPath)
	}
}

func TestResolveWikiPathExact(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "id1", Filename: "target.md", Path: "/wiki/concepts"},
	}
	rp := NewReferenceParser(docs)

	// Test via parseWikiLinks
	content := `[Link](concepts/target.md)`
	refs := rp.ParseReferences(content, "/wiki/test.md")
	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}
	if refs[0].TargetPath != "id1" {
		t.Errorf("expected TargetPath='id1', got %q", refs[0].TargetPath)
	}
}

func TestResolveWikiPathAppendMd(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "id1", Filename: "target.md", Path: "/wiki/concepts"},
	}
	rp := NewReferenceParser(docs)

	// Link without .md extension
	content := `[Link](concepts/target)`
	refs := rp.ParseReferences(content, "/wiki/test.md")
	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}
	if refs[0].TargetPath != "id1" {
		t.Errorf("expected TargetPath='id1', got %q", refs[0].TargetPath)
	}
}

func TestParseReferencesNoRefs(t *testing.T) {
	docs := []DocIndexEntry{}
	rp := NewReferenceParser(docs)

	content := "Just plain text with no references at all."
	refs := rp.ParseReferences(content, "/wiki/test.md")
	if len(refs) != 0 {
		t.Errorf("expected 0 references, got %d", len(refs))
	}
}

func TestParseCitationFile(t *testing.T) {
	tests := []struct {
		input      string
		wantFile   string
		wantPage   int
		hasPage    bool
	}{
		{"paper.pdf, p.3", "paper.pdf", 3, true},
		{"paper.pdf, p3", "paper.pdf", 3, true},
		{"book.epub", "book.epub", 0, false},
		{"report.pdf, p.42", "report.pdf", 42, true},
	}
	for _, tt := range tests {
		file, page := parseCitationFile(tt.input)
		if file != tt.wantFile {
			t.Errorf("parseCitationFile(%q) file = %q, want %q", tt.input, file, tt.wantFile)
		}
		if tt.hasPage {
			if page == nil {
				t.Errorf("parseCitationFile(%q) page is nil, want %d", tt.input, tt.wantPage)
			} else if *page != tt.wantPage {
				t.Errorf("parseCitationFile(%q) page = %d, want %d", tt.input, *page, tt.wantPage)
			}
		} else if page != nil {
			t.Errorf("parseCitationFile(%q) page should be nil", tt.input)
		}
	}
}

func TestStripExtension(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"file.pdf", "file"},
		{"document.docx", "document"},
		{"page.md", "page"},
		{"data.csv", "data"},
		{"noext", "noext"},
		{".hidden", ".hidden"},
	}
	for _, tt := range tests {
		got := stripExtension(tt.input)
		if got != tt.want {
			t.Errorf("stripExtension(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestNewReferenceParserIndexing(t *testing.T) {
	docs := []DocIndexEntry{
		{ID: "id1", Filename: "Paper.pdf", Title: "My Paper", Path: "/sources"},
		{ID: "id2", Filename: "notes.md", Path: "/wiki/concepts"},
	}
	rp := NewReferenceParser(docs)

	// Should be able to resolve by filename (case-insensitive)
	if id := rp.resolveFilename("paper.pdf"); id != "id1" {
		t.Errorf("resolveFilename('paper.pdf') = %q, want 'id1'", id)
	}
	// Should be able to resolve by title (case-insensitive)
	if id := rp.resolveFilename("my paper"); id != "id1" {
		t.Errorf("resolveFilename('my paper') = %q, want 'id1'", id)
	}
	// Should be able to resolve by base name
	if id := rp.resolveFilename("paper"); id != "id1" {
		t.Errorf("resolveFilename('paper') = %q, want 'id1'", id)
	}
}
