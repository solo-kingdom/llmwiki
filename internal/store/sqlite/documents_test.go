package sqlite

import (
	"testing"
)

func TestCreateDocument(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "test.md",
		Title:        "Test Document",
		Path:         "/wiki",
		RelativePath: "wiki/test.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Content:      "# Hello\n\nWorld",
		Status:       "ready",
		Tags:         []string{"test", "example"},
	}

	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	if doc.ID == "" {
		t.Error("expected doc.ID to be set after CreateDocument")
	}
	if doc.DocumentNumber != 1 {
		t.Errorf("expected DocumentNumber=1, got %d", doc.DocumentNumber)
	}

	// Verify it's in the DB
	got, err := db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got == nil {
		t.Fatal("GetDocument() returned nil")
	}
	if got.Filename != "test.md" {
		t.Errorf("expected Filename='test.md', got %q", got.Filename)
	}
	if got.Title != "Test Document" {
		t.Errorf("expected Title='Test Document', got %q", got.Title)
	}
	if got.Content != "# Hello\n\nWorld" {
		t.Errorf("expected Content='# Hello\\n\\nWorld', got %q", got.Content)
	}
	if len(got.Tags) != 2 || got.Tags[0] != "test" || got.Tags[1] != "example" {
		t.Errorf("expected Tags=['test','example'], got %v", got.Tags)
	}
}

func TestCreateDocumentWithCustomID(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		ID:           "custom-id-123",
		UserID:       "user1",
		Filename:     "custom.md",
		Title:        "Custom ID",
		Path:         "/wiki",
		RelativePath: "wiki/custom.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}

	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	if doc.ID != "custom-id-123" {
		t.Errorf("expected ID='custom-id-123', got %q", doc.ID)
	}
}

func TestCreateDocumentAutoNumbering(t *testing.T) {
	db := helperDB(t)

	for i := 1; i <= 3; i++ {
		doc := &Document{
			UserID:       "user1",
			Filename:     "doc" + string(rune('0'+i)) + ".md",
			Title:        "Doc " + string(rune('0'+i)),
			Path:         "/wiki",
			RelativePath: "wiki/doc" + string(rune('0'+i)) + ".md",
			SourceKind:   "wiki",
			FileType:     "md",
			Status:       "ready",
		}
		if err := db.CreateDocument(doc); err != nil {
			t.Fatalf("CreateDocument() doc %d error = %v", i, err)
		}
		if doc.DocumentNumber != int64(i) {
			t.Errorf("doc %d: expected DocumentNumber=%d, got %d", i, i, doc.DocumentNumber)
		}
	}
}

func TestGetDocumentNotFound(t *testing.T) {
	db := helperDB(t)

	got, err := db.GetDocument("nonexistent")
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got != nil {
		t.Error("expected nil for nonexistent document")
	}
}

func TestFindDocumentByName(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "My Page.md",
		Title:        "My Page Title",
		Path:         "/wiki",
		RelativePath: "wiki/My Page.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	// Find by filename (case-insensitive)
	got, err := db.FindDocumentByName("my page.md")
	if err != nil {
		t.Fatalf("FindDocumentByName() error = %v", err)
	}
	if got == nil {
		t.Fatal("FindDocumentByName() returned nil for filename match")
	}
	if got.ID != doc.ID {
		t.Errorf("expected ID=%q, got %q", doc.ID, got.ID)
	}

	// Find by title (case-insensitive)
	got2, err := db.FindDocumentByName("my page title")
	if err != nil {
		t.Fatalf("FindDocumentByName() error = %v", err)
	}
	if got2 == nil {
		t.Fatal("FindDocumentByName() returned nil for title match")
	}

	// Not found
	got3, err := db.FindDocumentByName("nonexistent")
	if err != nil {
		t.Fatalf("FindDocumentByName() error = %v", err)
	}
	if got3 != nil {
		t.Error("expected nil for nonexistent name")
	}
}

func TestGetDocumentByPath(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "notes.md",
		Title:        "Notes",
		Path:         "/wiki/notes",
		RelativePath: "wiki/notes/notes.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	got, err := db.GetDocumentByPath("notes.md", "/wiki/notes")
	if err != nil {
		t.Fatalf("GetDocumentByPath() error = %v", err)
	}
	if got == nil {
		t.Fatal("GetDocumentByPath() returned nil")
	}
	if got.ID != doc.ID {
		t.Errorf("expected ID=%q, got %q", doc.ID, got.ID)
	}

	// Not found
	got2, err := db.GetDocumentByPath("notes.md", "/wrong/path")
	if err != nil {
		t.Fatalf("GetDocumentByPath() error = %v", err)
	}
	if got2 != nil {
		t.Error("expected nil for wrong path")
	}
}

func TestUpdateDocument(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "update.md",
		Title:        "Original",
		Path:         "/wiki",
		RelativePath: "wiki/update.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Content:      "original content",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	// Update
	err := db.UpdateDocument(doc.ID, "new content", "Updated Title",
		[]string{"tag1", "tag2"}, "2024-01-01", `{"key":"val"}`)
	if err != nil {
		t.Fatalf("UpdateDocument() error = %v", err)
	}

	// Verify
	got, err := db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got.Content != "new content" {
		t.Errorf("expected Content='new content', got %q", got.Content)
	}
	if got.Title != "Updated Title" {
		t.Errorf("expected Title='Updated Title', got %q", got.Title)
	}
	if got.Version != 1 {
		t.Errorf("expected Version=1, got %d", got.Version)
	}
	if len(got.Tags) != 2 || got.Tags[0] != "tag1" {
		t.Errorf("expected Tags=['tag1','tag2'], got %v", got.Tags)
	}
	if got.Date != "2024-01-01" {
		t.Errorf("expected Date='2024-01-01', got %q", got.Date)
	}
}

func TestUpdateDocumentPartialFields(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "partial.md",
		Title:        "Original",
		Path:         "/wiki",
		RelativePath: "wiki/partial.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Content:      "original",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	// Update with empty title — should keep original
	err := db.UpdateDocument(doc.ID, "new content", "", nil, "", "")
	if err != nil {
		t.Fatalf("UpdateDocument() error = %v", err)
	}

	got, err := db.GetDocument(doc.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got.Title != "Original" {
		t.Errorf("expected Title to stay 'Original', got %q", got.Title)
	}
	if got.Content != "new content" {
		t.Errorf("expected Content='new content', got %q", got.Content)
	}
}

func TestArchiveDocuments(t *testing.T) {
	db := helperDB(t)

	doc1 := &Document{
		UserID:       "user1",
		Filename:     "doc1.md",
		Title:        "Doc 1",
		Path:         "/wiki",
		RelativePath: "wiki/doc1.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	doc2 := &Document{
		UserID:       "user1",
		Filename:     "doc2.md",
		Title:        "Doc 2",
		Path:         "/wiki",
		RelativePath: "wiki/doc2.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc1); err != nil {
		t.Fatalf("CreateDocument() doc1 error = %v", err)
	}
	if err := db.CreateDocument(doc2); err != nil {
		t.Fatalf("CreateDocument() doc2 error = %v", err)
	}

	// Archive doc1
	affected, err := db.ArchiveDocuments([]string{doc1.ID})
	if err != nil {
		t.Fatalf("ArchiveDocuments() error = %v", err)
	}
	if affected != 1 {
		t.Errorf("expected 1 affected row, got %d", affected)
	}

	// doc1 should be gone
	got, err := db.GetDocument(doc1.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got != nil {
		t.Error("expected doc1 to be deleted")
	}

	// doc2 should still exist
	got2, err := db.GetDocument(doc2.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got2 == nil {
		t.Error("expected doc2 to still exist")
	}
}

func TestArchiveDocumentsEmpty(t *testing.T) {
	db := helperDB(t)

	affected, err := db.ArchiveDocuments(nil)
	if err != nil {
		t.Fatalf("ArchiveDocuments(nil) error = %v", err)
	}
	if affected != 0 {
		t.Errorf("expected 0 affected rows, got %d", affected)
	}
}

func TestListDocuments(t *testing.T) {
	db := helperDB(t)

	// Empty database
	docs, err := db.ListDocuments()
	if err != nil {
		t.Fatalf("ListDocuments() error = %v", err)
	}
	if docs != nil {
		t.Error("expected nil for empty database")
	}

	// Create documents
	for _, name := range []string{"alpha.md", "beta.md", "gamma.md"} {
		doc := &Document{
			UserID:       "user1",
			Filename:     name,
			Title:        name,
			Path:         "/wiki",
			RelativePath: "wiki/" + name,
			SourceKind:   "wiki",
			FileType:     "md",
			Status:       "ready",
		}
		if err := db.CreateDocument(doc); err != nil {
			t.Fatalf("CreateDocument() error = %v", err)
		}
	}

	docs, err = db.ListDocuments()
	if err != nil {
		t.Fatalf("ListDocuments() error = %v", err)
	}
	if len(docs) != 3 {
		t.Fatalf("expected 3 documents, got %d", len(docs))
	}

	// Should be ordered by path, filename
	if docs[0].Filename != "alpha.md" {
		t.Errorf("expected first doc 'alpha.md', got %q", docs[0].Filename)
	}
}

func TestListDocumentsWithContent(t *testing.T) {
	db := helperDB(t)

	doc := &Document{
		UserID:       "user1",
		Filename:     "content.md",
		Title:        "Has Content",
		Path:         "/wiki",
		RelativePath: "wiki/content.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Content:      "some content here",
		Status:       "ready",
		Tags:         []string{"a", "b"},
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}

	docs, err := db.ListDocumentsWithContent()
	if err != nil {
		t.Fatalf("ListDocumentsWithContent() error = %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("expected 1 document, got %d", len(docs))
	}
	if docs[0].Content != "some content here" {
		t.Errorf("expected Content='some content here', got %q", docs[0].Content)
	}
	if len(docs[0].Tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(docs[0].Tags))
	}
}
