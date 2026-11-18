package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

// seedPGDoc inserts a ready document with the given identity.
func seedPGDoc(t *testing.T, db *postgres.DB, id, filename, path, relPath, kind string) *store.Document {
	t.Helper()
	doc := &store.Document{
		ID:           id,
		UserID:       "test-user",
		Filename:     filename,
		Title:        filename,
		Path:         path,
		RelativePath: relPath,
		SourceKind:   kind,
		FileType:     "md",
		Status:       "ready",
		Content:      "body of " + filename,
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument(%s): %v", filename, err)
	}
	return doc
}

func TestDocumentCRUDAndSoftDelete(t *testing.T) {
	db := pgtest.Open(t)

	doc := &store.Document{
		ID:           "custom-doc-id",
		UserID:       "test-user",
		Filename:     "crud-doc.md",
		Title:        "CRUD Doc",
		Path:         "/wiki/entities",
		RelativePath: "wiki/entities/crud-doc.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
		Content:      "hello world",
		Tags:         []string{"alpha", "beta"},
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	if doc.ID != "custom-doc-id" {
		t.Errorf("ID = %q, want custom-doc-id", doc.ID)
	}
	if doc.DocumentNumber != 1 {
		t.Errorf("DocumentNumber = %d, want 1", doc.DocumentNumber)
	}

	got, err := db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	if got == nil {
		t.Fatal("GetDocument returned nil")
	}
	if got.Filename != "crud-doc.md" || got.Content != "hello world" {
		t.Errorf("unexpected document: %+v", got)
	}
	if len(got.Tags) != 2 || got.Tags[0] != "alpha" || got.Tags[1] != "beta" {
		t.Errorf("Tags = %v, want [alpha beta]", got.Tags)
	}
	if got.Version != 0 {
		t.Errorf("Version = %d, want 0", got.Version)
	}
	if got.DeletedAt != "" {
		t.Errorf("DeletedAt = %q, want empty", got.DeletedAt)
	}

	byName, err := db.FindDocumentByName("crud-doc.md")
	if err != nil {
		t.Fatalf("FindDocumentByName: %v", err)
	}
	if byName == nil || byName.ID != doc.ID {
		t.Fatalf("FindDocumentByName = %+v, want id %q", byName, doc.ID)
	}
	byTitle, err := db.FindDocumentByName("crud doc")
	if err != nil {
		t.Fatalf("FindDocumentByName(title): %v", err)
	}
	if byTitle == nil || byTitle.ID != doc.ID {
		t.Fatalf("FindDocumentByName(title) = %+v, want id %q", byTitle, doc.ID)
	}

	byPath, err := db.GetDocumentByPath("crud-doc.md", "/wiki/entities")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if byPath == nil || byPath.ID != doc.ID {
		t.Fatalf("GetDocumentByPath = %+v, want id %q", byPath, doc.ID)
	}

	if err := db.UpdateDocument(doc.ID, "new content", "Updated Title",
		[]string{"gamma"}, "2026-01-02", `{"k":"v"}`); err != nil {
		t.Fatalf("UpdateDocument: %v", err)
	}
	got, err = db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument after update: %v", err)
	}
	if got.Content != "new content" || got.Title != "Updated Title" || got.Version != 1 {
		t.Errorf("after update: content=%q title=%q version=%d", got.Content, got.Title, got.Version)
	}
	if got.Date != "2026-01-02" || got.Metadata != `{"k":"v"}` {
		t.Errorf("after update: date=%q metadata=%q", got.Date, got.Metadata)
	}
	if len(got.Tags) != 1 || got.Tags[0] != "gamma" {
		t.Errorf("after update: tags=%v", got.Tags)
	}
	if got.UpdatedAt == "" {
		t.Error("UpdatedAt is empty after update")
	}

	docs, err := db.ListDocuments()
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("ListDocuments len = %d, want 1", len(docs))
	}
	if docs[0].PageType != "entity" {
		t.Errorf("PageType = %q, want entity", docs[0].PageType)
	}

	affected, err := db.ArchiveDocuments([]string{doc.ID})
	if err != nil {
		t.Fatalf("ArchiveDocuments: %v", err)
	}
	if affected != 1 {
		t.Errorf("ArchiveDocuments affected = %d, want 1", affected)
	}

	// Soft-deleted rows are still readable by ID for rollback and history.
	got, err = db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument after archive: %v", err)
	}
	if got == nil || got.DeletedAt == "" {
		t.Fatalf("GetDocument after archive = %+v, want deleted document", got)
	}

	docs, err = db.ListDocuments()
	if err != nil {
		t.Fatalf("ListDocuments after archive: %v", err)
	}
	if len(docs) != 0 {
		t.Errorf("ListDocuments after archive len = %d, want 0", len(docs))
	}

	byName, err = db.FindDocumentByName("crud-doc.md")
	if err != nil {
		t.Fatalf("FindDocumentByName after archive: %v", err)
	}
	if byName != nil {
		t.Errorf("FindDocumentByName after archive = %+v, want nil", byName)
	}

	byPath, err = db.GetDocumentByPath("crud-doc.md", "/wiki/entities")
	if err != nil {
		t.Fatalf("GetDocumentByPath after archive: %v", err)
	}
	if byPath != nil {
		t.Errorf("GetDocumentByPath after archive = %+v, want nil", byPath)
	}

	affected, err = db.ArchiveDocuments([]string{doc.ID})
	if err != nil {
		t.Fatalf("ArchiveDocuments second: %v", err)
	}
	if affected != 0 {
		t.Errorf("ArchiveDocuments second affected = %d, want 0", affected)
	}

	affected, err = db.ArchiveDocuments(nil)
	if err != nil || affected != 0 {
		t.Errorf("ArchiveDocuments(nil) = %d, %v; want 0, nil", affected, err)
	}
}

func TestCreateDocumentAutoNumbering(t *testing.T) {
	db := pgtest.Open(t)

	for i := 1; i <= 3; i++ {
		doc := seedPGDoc(t, db, "", "doc"+string(rune('0'+i))+".md", "/wiki", "wiki/doc"+string(rune('0'+i))+".md", "wiki")
		if doc.DocumentNumber != int64(i) {
			t.Errorf("doc %d DocumentNumber = %d, want %d", i, doc.DocumentNumber, i)
		}
		if doc.ID == "" {
			t.Errorf("doc %d got empty ID", i)
		}
	}
}

func TestGetWikiDocumentByID(t *testing.T) {
	db := pgtest.Open(t)

	wiki := seedPGDoc(t, db, "", "wiki-doc.md", "/wiki", "wiki/wiki-doc.md", "wiki")
	src := seedPGDoc(t, db, "", "src.pdf", "/sources", "sources/src.pdf", "source")

	got, err := db.GetWikiDocumentByID(wiki.ID)
	if err != nil || got == nil || got.ID != wiki.ID {
		t.Fatalf("GetWikiDocumentByID(wiki) = %+v, %v", got, err)
	}
	got, err = db.GetWikiDocumentByID(src.ID)
	if err != nil || got != nil {
		t.Fatalf("GetWikiDocumentByID(source) = %+v, %v; want nil", got, err)
	}
}

func TestListDocumentsFiltered(t *testing.T) {
	db := pgtest.Open(t)

	seedPGDoc(t, db, "", "entity.md", "/wiki/entities", "wiki/entities/entity.md", "wiki")
	seedPGDoc(t, db, "", "concept.md", "/wiki/concepts", "wiki/concepts/concept.md", "wiki")
	seedPGDoc(t, db, "", "template.md", "/wiki/templates", "wiki/templates/template.md", "wiki")
	seedPGDoc(t, db, "", "summary.md", "/wiki/sources", "wiki/sources/summary.md", "wiki")
	seedPGDoc(t, db, "", "synthesis.md", "/wiki/synthesis", "wiki/synthesis/synthesis.md", "wiki")
	seedPGDoc(t, db, "", "paper.pdf", "/sources", "sources/paper.pdf", "source")

	all, err := db.ListDocumentsFiltered(store.ListDocumentsFilter{})
	if err != nil {
		t.Fatalf("ListDocumentsFiltered: %v", err)
	}
	if len(all) != 6 {
		t.Fatalf("len(all) = %d, want 6", len(all))
	}

	visible, err := db.ListDocumentsFiltered(store.ListDocumentsFilter{ExcludeHidden: true})
	if err != nil {
		t.Fatalf("ListDocumentsFiltered(hidden): %v", err)
	}
	if len(visible) != 4 {
		t.Fatalf("len(visible) = %d, want 4", len(visible))
	}
	for _, d := range visible {
		if d.RelativePath == "wiki/templates/template.md" || d.RelativePath == "wiki/sources/summary.md" {
			t.Errorf("hidden document leaked: %s", d.RelativePath)
		}
	}

	wikiVisible, err := db.ListDocumentsFiltered(store.ListDocumentsFilter{
		SourceKind:    "wiki",
		ExcludeHidden: true,
	})
	if err != nil {
		t.Fatalf("ListDocumentsFiltered(wiki): %v", err)
	}
	if len(wikiVisible) != 3 {
		t.Fatalf("len(wikiVisible) = %d, want 3", len(wikiVisible))
	}

	entities, err := db.ListDocumentsFiltered(store.ListDocumentsFilter{
		SourceKind: "wiki",
		PageTypes:  []string{"entity"},
	})
	if err != nil {
		t.Fatalf("ListDocumentsFiltered(page type): %v", err)
	}
	if len(entities) != 1 || entities[0].Filename != "entity.md" {
		t.Fatalf("entities = %+v, want only entity.md", entities)
	}
}

func TestListDocumentsWithContent(t *testing.T) {
	db := pgtest.Open(t)

	seedPGDoc(t, db, "", "content.md", "/wiki", "wiki/content.md", "wiki")

	docs, err := db.ListDocumentsWithContent()
	if err != nil {
		t.Fatalf("ListDocumentsWithContent: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("len = %d, want 1", len(docs))
	}
	if docs[0].Content == "" {
		t.Error("Content is empty")
	}
}
