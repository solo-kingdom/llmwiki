package ingest

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeConversation(t *testing.T) {
	n, err := NormalizeConversation("My Topic", "hello", "", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	if err != nil {
		t.Fatalf("NormalizeConversation() error = %v", err)
	}
	if n.Kind != InputKindConversation {
		t.Fatalf("kind = %q, want %q", n.Kind, InputKindConversation)
	}
	if !strings.HasPrefix(n.CanonicalPath, WebIngestBaseDir+"/") {
		t.Fatalf("canonical path = %q", n.CanonicalPath)
	}
	if n.SourceRef != "conversation" {
		t.Fatalf("source_ref = %q, want conversation", n.SourceRef)
	}
}

func TestNormalizeText(t *testing.T) {
	n, err := NormalizeText("Title", "", "markdown body", "manual", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	if err != nil {
		t.Fatalf("NormalizeText() error = %v", err)
	}
	if n.Kind != InputKindText {
		t.Fatalf("kind = %q, want %q", n.Kind, InputKindText)
	}
	if n.SourceRef != "manual" {
		t.Fatalf("source_ref = %q, want manual", n.SourceRef)
	}
}

func TestNormalizeUploadValidation(t *testing.T) {
	if _, err := NormalizeUpload("", []byte("abc"), ""); err == nil {
		t.Fatal("expected error for empty filename")
	}
	if _, err := NormalizeUpload("a.md", nil, ""); err == nil {
		t.Fatal("expected error for empty content")
	}
}
