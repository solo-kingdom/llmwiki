package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type ProcessingTier string

const (
	TierA ProcessingTier = "A"
	TierB ProcessingTier = "B"
	TierC ProcessingTier = "C"
)

type ProcessingCapability struct {
	FileType    string         `json:"file_type"`
	Tier        ProcessingTier `json:"tier"`
	CanExtract  bool           `json:"can_extract"`
	CanChunk    bool           `json:"can_chunk"`
	MissingDeps []string       `json:"missing_deps,omitempty"`
	Remediation string         `json:"remediation,omitempty"`
}

type SourceProcessor struct {
	dependencies map[string]bool
}

func NewSourceProcessor() *SourceProcessor {
	sp := &SourceProcessor{
		dependencies: make(map[string]bool),
	}
	sp.probeAll()
	return sp
}

func (sp *SourceProcessor) probeAll() {
	sp.checkDependency("pdftotext")
	sp.checkDependency("libreoffice")
	sp.checkDependency("soffice")
}

func (sp *SourceProcessor) checkDependency(name string) bool {
	if found, ok := sp.dependencies[name]; ok {
		return found
	}
	_, err := exec.LookPath(name)
	sp.dependencies[name] = err == nil
	return sp.dependencies[name]
}

func (sp *SourceProcessor) hasLibreOffice() bool {
	return sp.dependencies["libreoffice"] || sp.dependencies["soffice"]
}

func (sp *SourceProcessor) GetCapabilities() []ProcessingCapability {
	caps := []ProcessingCapability{
		sp.capabilityForExt(".md"),
		sp.capabilityForExt(".txt"),
		sp.capabilityForExt(".pdf"),
		sp.capabilityForExt(".docx"),
		sp.capabilityForExt(".pptx"),
		sp.capabilityForExt(".xlsx"),
	}
	return caps
}

func (sp *SourceProcessor) capabilityForExt(ext string) ProcessingCapability {
	switch ext {
	case ".md", ".txt":
		return ProcessingCapability{
			FileType:   ext,
			Tier:       TierA,
			CanExtract: true,
			CanChunk:   true,
		}
	case ".pdf":
		if sp.checkDependency("pdftotext") {
			return ProcessingCapability{
				FileType:   ext,
				Tier:       TierB,
				CanExtract: true,
				CanChunk:   true,
			}
		}
		return ProcessingCapability{
			FileType:    ext,
			Tier:        TierC,
			CanExtract:  false,
			CanChunk:    false,
			MissingDeps: []string{"pdftotext"},
			Remediation: "Install poppler-utils: apt-get install poppler-utils (Debian/Ubuntu) or brew install poppler (macOS)",
		}
	case ".docx", ".pptx", ".xlsx":
		if sp.hasLibreOffice() {
			return ProcessingCapability{
				FileType:   ext,
				Tier:       TierB,
				CanExtract: true,
				CanChunk:   true,
			}
		}
		return ProcessingCapability{
			FileType:    ext,
			Tier:        TierC,
			CanExtract:  false,
			CanChunk:    false,
			MissingDeps: []string{"libreoffice"},
			Remediation: "Install LibreOffice: apt-get install libreoffice (Debian/Ubuntu) or brew install libreoffice (macOS)",
		}
	default:
		return ProcessingCapability{
			FileType:    ext,
			Tier:        TierC,
			CanExtract:  false,
			CanChunk:    false,
			Remediation: fmt.Sprintf("File type %s is not supported for text extraction", ext),
		}
	}
}

func (sp *SourceProcessor) ProcessSource(filePath string) (string, ProcessingCapability, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	cap := sp.capabilityForExt(ext)

	switch cap.Tier {
	case TierA:
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", cap, fmt.Errorf("read file %s: %w", filePath, err)
		}
		return string(data), cap, nil
	case TierB:
		return sp.processTierB(filePath, ext, cap)
	default:
		return "", cap, nil
	}
}

func (sp *SourceProcessor) processTierB(filePath string, ext string, cap ProcessingCapability) (string, ProcessingCapability, error) {
	switch ext {
	case ".pdf":
		return sp.extractPDF(filePath, cap)
	case ".docx", ".pptx", ".xlsx":
		return sp.extractOffice(filePath, ext, cap)
	default:
		return "", cap, fmt.Errorf("unsupported tier B file type: %s", ext)
	}
}

func (sp *SourceProcessor) extractPDF(filePath string, cap ProcessingCapability) (string, ProcessingCapability, error) {
	cmd := exec.Command("pdftotext", "-layout", filePath, "-")
	out, err := cmd.Output()
	if err != nil {
		return "", cap, fmt.Errorf("pdftotext failed: %w", err)
	}
	return strings.TrimSpace(string(out)), cap, nil
}

func (sp *SourceProcessor) extractOffice(filePath string, ext string, cap ProcessingCapability) (string, ProcessingCapability, error) {
	convertTo := "txt:Text"
	if ext == ".pptx" {
		convertTo = "html:HTML"
	}

	tmpDir, err := os.MkdirTemp("", "llmwiki-office-*")
	if err != nil {
		return "", cap, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	binName := "libreoffice"
	if sp.dependencies["soffice"] && !sp.dependencies["libreoffice"] {
		binName = "soffice"
	}

	cmd := exec.Command(binName, "--headless", "--convert-to", convertTo, "--outdir", tmpDir, filePath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", cap, fmt.Errorf("libreoffice conversion failed: %s: %w", string(out), err)
	}

	base := strings.TrimSuffix(filepath.Base(filePath), ext)
	var outPath string
	switch ext {
	case ".pptx":
		outPath = filepath.Join(tmpDir, base+".html")
	default:
		outPath = filepath.Join(tmpDir, base+".txt")
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		return "", cap, fmt.Errorf("read converted output: %w", err)
	}
	return strings.TrimSpace(string(data)), cap, nil
}
