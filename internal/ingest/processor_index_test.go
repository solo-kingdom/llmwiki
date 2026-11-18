package ingest

import (
	"context"
	"strings"
	"testing"
)

func TestApplyBlocksToStorePersistsPagesAndChunks(t *testing.T) {
	db := openTestDB(t)

	ws := t.TempDir()
	pipeline := NewPipelineWithDB(ws, db, nil)
	pipeline.SetChangeSetMeta("ingest", "job-index-test", "", "source.md", "source content")

	longBody := "UniqueIngestIndexToken98765 appears in this paragraph. " +
		strings.Repeat("Additional indexing filler text for chunk token minimum. ", 20)
	rel := "wiki/entities/searchable-ingest.md"
	blocks := map[string]string{
		rel: "# Searchable\n\n" + longBody + "\n",
	}

	result, err := pipeline.applyBlocksToStore(context.Background(), blocks)
	if err != nil {
		t.Fatalf("applyBlocksToStore: %v", err)
	}
	if len(result.Written) != 1 || result.Written[0] != rel {
		t.Fatalf("written = %v, want [%s]", result.Written, rel)
	}

	ctx := context.Background()
	var docID, content string
	if err := db.Pool().QueryRow(ctx,
		`SELECT id, COALESCE(content, '') FROM documents WHERE relative_path = $1`, rel).
		Scan(&docID, &content); err != nil {
		t.Fatalf("load document row: %v", err)
	}
	if !strings.Contains(content, "UniqueIngestIndexToken98765") {
		t.Fatalf("document content missing expected text: %q", content)
	}

	var chunkCount int
	if err := db.Pool().QueryRow(ctx,
		`SELECT COUNT(*) FROM document_chunks WHERE document_id = $1`, docID).Scan(&chunkCount); err != nil {
		t.Fatalf("count chunks: %v", err)
	}
	if chunkCount == 0 {
		t.Fatal("expected document_chunks rows after apply")
	}

	var matchingChunks int
	if err := db.Pool().QueryRow(ctx,
		`SELECT COUNT(*) FROM document_chunks WHERE document_id = $1 AND content LIKE '%' || $2 || '%'`,
		docID, "UniqueIngestIndexToken98765").Scan(&matchingChunks); err != nil {
		t.Fatalf("count matching chunks: %v", err)
	}
	if matchingChunks == 0 {
		t.Fatal("expected a chunk containing the indexed token")
	}

	var revisionCount int
	if err := db.Pool().QueryRow(ctx,
		`SELECT COUNT(*) FROM page_revisions WHERE document_id = $1 AND relative_path = $2`, docID, rel).
		Scan(&revisionCount); err != nil {
		t.Fatalf("count revisions: %v", err)
	}
	if revisionCount != 1 {
		t.Fatalf("revision count = %d, want 1", revisionCount)
	}

	csID := pipeline.LastChangeSetID()
	if csID == "" {
		t.Fatal("expected change set id")
	}
	cs, err := db.GetChangeSet(csID)
	if err != nil {
		t.Fatalf("GetChangeSet: %v", err)
	}
	if cs == nil || cs.Kind != "ingest" || cs.JobID != "job-index-test" {
		t.Fatalf("change set = %+v, want kind=ingest job=job-index-test", cs)
	}
	if cs.PageCount != 1 {
		t.Fatalf("page count = %d, want 1", cs.PageCount)
	}
}
