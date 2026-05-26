package api

import (
	"log"
	"net/http"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

type capabilitiesResponse struct {
	FileTypes       []fileTypeCapability `json:"file_types"`
	ProcessingTiers []processingTier     `json:"processing_tiers"`
	RuntimeDeps     []depStatus          `json:"runtime_dependencies"`
	AccessModel     string               `json:"access_model"`
}

type fileTypeCapability struct {
	Extension    string   `json:"extension"`
	MIMEType     string   `json:"mime_type"`
	Tier         string   `json:"tier"`
	CanExtract   bool     `json:"can_extract"`
	CanChunk     bool     `json:"can_chunk"`
	MissingDeps  []string `json:"missing_deps,omitempty"`
	Remediation  string   `json:"remediation,omitempty"`
}

type processingTier struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type depStatus struct {
	Name    string `json:"name"`
	Found   bool   `json:"found"`
	Purpose string `json:"purpose"`
}

// sourceProcessor is lazily initialized once
var srcProcessor = engine.NewSourceProcessor()

func init() {
	// Log dependency probe results at startup
	caps := srcProcessor.GetCapabilities()
	for _, c := range caps {
		if len(c.MissingDeps) > 0 {
			log.Printf("[source-processing] %s: tier %s (missing: %v) — %s", c.FileType, c.Tier, c.MissingDeps, c.Remediation)
		} else {
			log.Printf("[source-processing] %s: tier %s (available)", c.FileType, c.Tier)
		}
	}
}

func buildCapabilities() capabilitiesResponse {
	procCaps := srcProcessor.GetCapabilities()

	ftCaps := make([]fileTypeCapability, len(procCaps))
	for i, c := range procCaps {
		ftCaps[i] = fileTypeCapability{
			Extension:   c.FileType,
			Tier:        string(c.Tier),
			CanExtract:  c.CanExtract,
			CanChunk:    c.CanChunk,
			MissingDeps: c.MissingDeps,
			Remediation: c.Remediation,
		}
	}

	// Add MIME types
	mimes := map[string]string{
		".md":   "text/markdown",
		".txt":  "text/plain",
		".pdf":  "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	}
	for i := range ftCaps {
		if m, ok := mimes[ftCaps[i].Extension]; ok {
			ftCaps[i].MIMEType = m
		}
	}

	// Build dependency status
	deps := []depStatus{
		{Name: "pdftotext", Found: false, Purpose: "PDF text extraction (Tier B for .pdf)"},
		{Name: "libreoffice", Found: false, Purpose: "Office document conversion (Tier B for .docx/.pptx/.xlsx)"},
	}
	// Check actual availability
	for i := range deps {
		for _, c := range procCaps {
			for _, dep := range c.MissingDeps {
				if dep == deps[i].Name {
					deps[i].Found = false
				}
			}
			if c.Tier == engine.TierB && (c.FileType == ".pdf" && deps[i].Name == "pdftotext" ||
				c.FileType != ".pdf" && deps[i].Name == "libreoffice") {
				deps[i].Found = true
			}
		}
	}

	return capabilitiesResponse{
		FileTypes: ftCaps,
		ProcessingTiers: []processingTier{
			{Name: "A", Description: "Built-in text extraction (markdown, plain text)"},
			{Name: "B", Description: "Optional system dependency extraction (pdftotext, LibreOffice)"},
			{Name: "C", Description: "Degraded fallback — file type recognized but extraction unavailable"},
		},
		RuntimeDeps: deps,
		AccessModel: "rpc-first",
	}
}

var capabilities = buildCapabilities()

func (a *API) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, capabilities)
}
