package ingest

import (
	"context"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

func TestParseFileBlocksWithContent(t *testing.T) {
	output := `Here are the rollback files:

---FILE: wiki/page1.md
# Page 1
Original content
---END FILE---

---FILE: wiki/page2.md
---DELETE---
---END FILE---`

	blocks := parseFileBlocksWithContent(output)
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}

	content1, ok := blocks["wiki/page1.md"]
	if !ok {
		t.Fatal("expected wiki/page1.md in blocks")
	}
	if !contains(content1, "Original content") {
		t.Errorf("page1 content: %q", content1)
	}

	content2, ok := blocks["wiki/page2.md"]
	if !ok {
		t.Fatal("expected wiki/page2.md in blocks")
	}
	if content2 != "---DELETE---\n" {
		t.Errorf("page2 content: %q", content2)
	}
}

func TestProcessRollbackJobRestoresPageAndAppendsHistory(t *testing.T) {
	db := openTestDB(t)
	rel := "wiki/entities/rollback-page.md"

	baseline := &store.ChangeSet{Kind: "ingest", Summary: "baseline create"}
	if err := db.ApplyChangeSet(baseline, []store.PageWrite{{
		Document: &store.Document{
			Filename:     "rollback-page.md",
			Title:        "Rollback Page",
			Path:         "/wiki/entities/",
			RelativePath: rel,
			SourceKind:   "wiki",
			FileType:     "md",
			Status:       "ready",
			Content:      "# V1\n\nfirst revision",
			ContentHash:  "hash-v1",
		},
		Operation: store.RevisionCreate,
		Chunks:    []store.Chunk{{ChunkIndex: 0, Content: "first revision", TokenCount: 2}},
	}}); err != nil {
		t.Fatalf("baseline ApplyChangeSet: %v", err)
	}

	ctx := context.Background()
	var createdID string
	if err := db.Pool().QueryRow(ctx,
		`SELECT id FROM documents WHERE relative_path = $1`, rel).Scan(&createdID); err != nil {
		t.Fatalf("load created document: %v", err)
	}

	update := &store.ChangeSet{Kind: "ingest", Summary: "update content"}
	if err := db.ApplyChangeSet(update, []store.PageWrite{{
		Document: &store.Document{
			ID:           createdID,
			Filename:     "rollback-page.md",
			Title:        "Rollback Page",
			Path:         "/wiki/entities/",
			RelativePath: rel,
			SourceKind:   "wiki",
			FileType:     "md",
			Status:       "ready",
			Content:      "# V2\n\nsecond revision",
			ContentHash:  "hash-v2",
		},
		Operation: store.RevisionUpdate,
		Chunks:    []store.Chunk{{ChunkIndex: 0, Content: "second revision", TokenCount: 2}},
	}}); err != nil {
		t.Fatalf("update ApplyChangeSet: %v", err)
	}

	var updatedContent string
	if err := db.Pool().QueryRow(ctx,
		`SELECT COALESCE(content, '') FROM documents WHERE id = $1`, createdID).Scan(&updatedContent); err != nil {
		t.Fatalf("load updated document: %v", err)
	}
	if !strings.Contains(updatedContent, "second revision") {
		t.Fatalf("updated content = %q, want second revision", updatedContent)
	}

	job := &store.IngestJob{
		InputType:  "rollback",
		SourcePath: "raw/rollback.md",
		SourceRef:  update.ID,
		Status:     "running",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	processor := NewJobProcessor(db, t.TempDir())
	if err := processor.processRollbackJob(context.Background(), job); err != nil {
		t.Fatalf("processRollbackJob: %v", err)
	}

	var restoredID, restoredContent string
	if err := db.Pool().QueryRow(ctx,
		`SELECT id, COALESCE(content, '') FROM documents WHERE relative_path = $1`, rel).
		Scan(&restoredID, &restoredContent); err != nil {
		t.Fatalf("load restored document row: %v", err)
	}
	if !strings.Contains(restoredContent, "first revision") {
		t.Fatalf("restored content = %q, want first revision", restoredContent)
	}
	if restoredID != createdID {
		t.Fatalf("restored document id = %q, want %q", restoredID, createdID)
	}

	finished, err := db.GetIngestJob(job.ID)
	if err != nil || finished == nil {
		t.Fatalf("load finished job: job=%v err=%v", finished, err)
	}
	if finished.Status != "succeeded" {
		t.Fatalf("job status = %q, want succeeded", finished.Status)
	}
	if !strings.Contains(finished.ResultSummary, "rolled back") {
		t.Fatalf("result summary = %q, want rollback summary", finished.ResultSummary)
	}

	changeSets, err := db.ListChangeSets(10, "")
	if err != nil {
		t.Fatalf("ListChangeSets: %v", err)
	}
	var rollbackSet *store.ChangeSet
	for i := range changeSets {
		if changeSets[i].Kind == "rollback" && changeSets[i].RollbackOf == update.ID {
			rollbackSet = &changeSets[i]
			break
		}
	}
	if rollbackSet == nil {
		t.Fatalf("expected rollback change set for %s, got %+v", update.ID, changeSets)
	}
	if rollbackSet.PageCount != 1 {
		t.Fatalf("rollback page count = %d, want 1", rollbackSet.PageCount)
	}

	revisions, err := db.ListPageRevisions(rel, 10)
	if err != nil {
		t.Fatalf("ListPageRevisions: %v", err)
	}
	if len(revisions) != 3 {
		t.Fatalf("revision count = %d, want 3 (create, update, rollback)", len(revisions))
	}
	latest := revisions[0]
	if latest.Operation != store.RevisionRestore {
		t.Fatalf("latest operation = %q, want restore", latest.Operation)
	}
	if latest.ChangeSetID != rollbackSet.ID {
		t.Fatalf("latest revision change set = %q, want %q", latest.ChangeSetID, rollbackSet.ID)
	}
	if !strings.Contains(latest.Content, "first revision") {
		t.Fatalf("latest revision content = %q, want first revision", latest.Content)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
