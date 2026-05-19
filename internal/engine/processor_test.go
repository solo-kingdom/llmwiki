package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMDAlwaysTierA(t *testing.T) {
	sp := NewSourceProcessor()
	for _, ext := range []string{".md", ".txt"} {
		cap := sp.capabilityForExt(ext)
		if cap.Tier != TierA {
			t.Errorf("expected %s to be Tier A, got %s", ext, cap.Tier)
		}
		if !cap.CanExtract {
			t.Errorf("expected %s CanExtract=true", ext)
		}
		if !cap.CanChunk {
			t.Errorf("expected %s CanChunk=true", ext)
		}
		if len(cap.MissingDeps) != 0 {
			t.Errorf("expected no missing deps for %s, got %v", ext, cap.MissingDeps)
		}
	}
}

func TestPDFFallbackTierC(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  false,
			"libreoffice": false,
			"soffice":    false,
		},
	}
	cap := sp.capabilityForExt(".pdf")
	if cap.Tier != TierC {
		t.Errorf("expected Tier C when pdftotext missing, got %s", cap.Tier)
	}
	if cap.CanExtract {
		t.Error("expected CanExtract=false for Tier C PDF")
	}
	if len(cap.MissingDeps) == 0 || cap.MissingDeps[0] != "pdftotext" {
		t.Errorf("expected missing dep pdftotext, got %v", cap.MissingDeps)
	}
	if cap.Remediation == "" {
		t.Error("expected non-empty remediation for Tier C PDF")
	}
}

func TestDOCXFallbackTierC(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  false,
			"libreoffice": false,
			"soffice":    false,
		},
	}
	for _, ext := range []string{".docx", ".pptx", ".xlsx"} {
		cap := sp.capabilityForExt(ext)
		if cap.Tier != TierC {
			t.Errorf("expected %s Tier C when libreoffice missing, got %s", ext, cap.Tier)
		}
		if cap.CanExtract {
			t.Errorf("expected %s CanExtract=false for Tier C", ext)
		}
		if len(cap.MissingDeps) == 0 || cap.MissingDeps[0] != "libreoffice" {
			t.Errorf("expected missing dep libreoffice for %s, got %v", ext, cap.MissingDeps)
		}
		if cap.Remediation == "" {
			t.Errorf("expected non-empty remediation for Tier C %s", ext)
		}
	}
}

func TestPDFTierBWhenAvailable(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  true,
			"libreoffice": false,
			"soffice":    false,
		},
	}
	cap := sp.capabilityForExt(".pdf")
	if cap.Tier != TierB {
		t.Errorf("expected Tier B when pdftotext available, got %s", cap.Tier)
	}
	if !cap.CanExtract || !cap.CanChunk {
		t.Error("expected CanExtract and CanChunk for Tier B")
	}
}

func TestOfficeTierBWhenLibreOfficeAvailable(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  false,
			"libreoffice": true,
			"soffice":    false,
		},
	}
	cap := sp.capabilityForExt(".docx")
	if cap.Tier != TierB {
		t.Errorf("expected Tier B when libreoffice available, got %s", cap.Tier)
	}
}

func TestOfficeTierBViaSoffice(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  false,
			"libreoffice": false,
			"soffice":    true,
		},
	}
	cap := sp.capabilityForExt(".docx")
	if cap.Tier != TierB {
		t.Errorf("expected Tier B when soffice available, got %s", cap.Tier)
	}
}

func TestUnknownExtTierC(t *testing.T) {
	sp := NewSourceProcessor()
	cap := sp.capabilityForExt(".xyz")
	if cap.Tier != TierC {
		t.Errorf("expected Tier C for unknown extension, got %s", cap.Tier)
	}
	if cap.CanExtract {
		t.Error("expected CanExtract=false for unknown extension")
	}
	if cap.Remediation == "" {
		t.Error("expected non-empty remediation for unsupported type")
	}
}

func TestProcessSourceTierA(t *testing.T) {
	tmpDir := t.TempDir()
	f := filepath.Join(tmpDir, "test.md")
	content := "# Hello\n\nWorld"
	if err := os.WriteFile(f, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	sp := NewSourceProcessor()
	got, cap, err := sp.ProcessSource(f)
	if err != nil {
		t.Fatal(err)
	}
	if cap.Tier != TierA {
		t.Errorf("expected Tier A, got %s", cap.Tier)
	}
	if got != content {
		t.Errorf("expected %q, got %q", content, got)
	}
}

func TestProcessSourceTierCNoError(t *testing.T) {
	tmpDir := t.TempDir()
	f := filepath.Join(tmpDir, "test.xyz")
	if err := os.WriteFile(f, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	sp := &SourceProcessor{
		dependencies: map[string]bool{},
	}
	got, cap, err := sp.ProcessSource(f)
	if err != nil {
		t.Errorf("expected no error for Tier C, got %v", err)
	}
	if cap.Tier != TierC {
		t.Errorf("expected Tier C, got %s", cap.Tier)
	}
	if got != "" {
		t.Errorf("expected empty content for Tier C, got %q", got)
	}
}

func TestGetCapabilities(t *testing.T) {
	sp := NewSourceProcessor()
	caps := sp.GetCapabilities()
	if len(caps) < 3 {
		t.Errorf("expected at least 3 capabilities, got %d", len(caps))
	}
	exts := map[string]bool{}
	for _, c := range caps {
		exts[c.FileType] = true
	}
	for _, expected := range []string{".md", ".txt", ".pdf", ".docx"} {
		if !exts[expected] {
			t.Errorf("missing capability for %s", expected)
		}
	}
}

func TestRemediationMessages(t *testing.T) {
	sp := &SourceProcessor{
		dependencies: map[string]bool{
			"pdftotext":  false,
			"libreoffice": false,
			"soffice":    false,
		},
	}
	pdfCap := sp.capabilityForExt(".pdf")
	if pdfCap.Remediation == "" {
		t.Error("PDF Tier C should have remediation message")
	}
	if !contains(pdfCap.Remediation, "poppler") {
		t.Errorf("PDF remediation should mention poppler, got: %s", pdfCap.Remediation)
	}

	docxCap := sp.capabilityForExt(".docx")
	if docxCap.Remediation == "" {
		t.Error("DOCX Tier C should have remediation message")
	}
	if !contains(docxCap.Remediation, "LibreOffice") {
		t.Errorf("DOCX remediation should mention LibreOffice, got: %s", docxCap.Remediation)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstr(s, substr))
}

func containsSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
