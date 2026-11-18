package postgres_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestSourceBlobDedupAndRead(t *testing.T) {
	db := pgtest.Open(t)

	data := []byte("hello source")
	sum := sha256.Sum256(data)
	wantSHA := hex.EncodeToString(sum[:])

	blob := &store.SourceBlob{
		ID:        "blob_1",
		Filename:  "hello.txt",
		MediaType: "text/plain",
	}
	if err := db.CreateSourceBlob(blob, data); err != nil {
		t.Fatalf("CreateSourceBlob: %v", err)
	}
	if blob.SHA256 != wantSHA {
		t.Fatalf("sha256 = %q, want %q", blob.SHA256, wantSHA)
	}
	if blob.Size != int64(len(data)) {
		t.Fatalf("size = %d, want %d", blob.Size, len(data))
	}
	if blob.CreatedAt == "" {
		t.Fatal("expected CreatedAt backfilled")
	}

	got, gotData, err := db.GetSourceBlob("blob_1")
	if err != nil || got == nil {
		t.Fatalf("GetSourceBlob = %+v, %v", got, err)
	}
	if !bytes.Equal(gotData, data) {
		t.Fatalf("bytes = %q, want %q", gotData, data)
	}
	if got.Filename != "hello.txt" || got.MediaType != "text/plain" || got.SHA256 != wantSHA {
		t.Fatalf("unexpected metadata: %+v", got)
	}
	if got.DocumentID != "" {
		t.Fatalf("document_id = %q, want empty", got.DocumentID)
	}

	got, gotData, err = db.GetSourceBlobBySHA(wantSHA)
	if err != nil || got == nil || !bytes.Equal(gotData, data) {
		t.Fatalf("GetSourceBlobBySHA = %+v, %q, %v", got, gotData, err)
	}

	// Same content under a different id dedupes on sha256 and reports the canonical row.
	dup := &store.SourceBlob{
		ID:        "blob_2",
		Filename:  "copy.txt",
		MediaType: "text/plain",
	}
	if err := db.CreateSourceBlob(dup, data); err != nil {
		t.Fatalf("CreateSourceBlob duplicate: %v", err)
	}
	if dup.ID != "blob_1" {
		t.Fatalf("duplicate id = %q, want canonical blob_1", dup.ID)
	}
	if dup.Filename != "hello.txt" || dup.SHA256 != wantSHA {
		t.Fatalf("duplicate metadata = %+v, want canonical row", dup)
	}

	other := &store.SourceBlob{ID: "blob_3", Filename: "other.bin", MediaType: "application/octet-stream"}
	if err := db.CreateSourceBlob(other, []byte("different")); err != nil {
		t.Fatalf("CreateSourceBlob other: %v", err)
	}

	list, err := db.ListSourceBlobs()
	if err != nil {
		t.Fatalf("ListSourceBlobs: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("ListSourceBlobs len = %d, want 2 (deduped)", len(list))
	}

	if got, gotData, err := db.GetSourceBlob("missing"); err != nil || got != nil || gotData != nil {
		t.Fatalf("GetSourceBlob missing = %+v, %q, %v; want nil, nil, nil", got, gotData, err)
	}
	if got, gotData, err := db.GetSourceBlobBySHA("deadbeef"); err != nil || got != nil || gotData != nil {
		t.Fatalf("GetSourceBlobBySHA missing = %+v, %q, %v; want nil, nil, nil", got, gotData, err)
	}

	if err := db.DeleteSourceBlob("blob_1"); err != nil {
		t.Fatalf("DeleteSourceBlob: %v", err)
	}
	if got, _, err := db.GetSourceBlob("blob_1"); err != nil || got != nil {
		t.Fatalf("GetSourceBlob after delete = %+v, %v; want nil, nil", got, err)
	}
	if err := db.DeleteSourceBlob("blob_1"); err == nil {
		t.Fatal("expected error deleting missing blob")
	}

	if err := db.CreateSourceBlob(nil, data); err == nil {
		t.Fatal("expected error for nil blob")
	}
	created := &store.SourceBlob{Filename: "x"}
	if err := db.CreateSourceBlob(created, data); err != nil {
		t.Fatalf("CreateSourceBlob with generated id: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected generated blob id")
	}
}

func TestSourceBlobExplicitSHA(t *testing.T) {
	db := pgtest.Open(t)

	// A caller-provided SHA-256 is trusted instead of recomputed.
	blob := &store.SourceBlob{
		ID:        "blob_explicit",
		Filename:  "weird.txt",
		MediaType: "text/plain",
		SHA256:    "0000000000000000000000000000000000000000000000000000000000000000",
	}
	if err := db.CreateSourceBlob(blob, []byte("payload")); err != nil {
		t.Fatalf("CreateSourceBlob: %v", err)
	}
	if blob.SHA256 != "0000000000000000000000000000000000000000000000000000000000000000" {
		t.Fatalf("sha256 = %q, want caller-provided value", blob.SHA256)
	}
	got, data, err := db.GetSourceBlobBySHA(blob.SHA256)
	if err != nil || got == nil || string(data) != "payload" {
		t.Fatalf("GetSourceBlobBySHA = %+v, %q, %v", got, data, err)
	}
}
