package api

import (
	"net/http"
)

type capabilitiesResponse struct {
	FileTypes      []fileTypeCapability `json:"file_types"`
	ProcessingTiers []processingTier    `json:"processing_tiers"`
}

type fileTypeCapability struct {
	Extension string `json:"extension"`
	MIMEType  string `json:"mime_type"`
	Tier      string `json:"tier"`
}

type processingTier struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

var capabilities = capabilitiesResponse{
	FileTypes: []fileTypeCapability{
		{Extension: ".md", MIMEType: "text/markdown", Tier: "full"},
		{Extension: ".txt", MIMEType: "text/plain", Tier: "full"},
		{Extension: ".pdf", MIMEType: "application/pdf", Tier: "full"},
		{Extension: ".epub", MIMEType: "application/epub+zip", Tier: "full"},
		{Extension: ".html", MIMEType: "text/html", Tier: "full"},
		{Extension: ".htm", MIMEType: "text/html", Tier: "full"},
		{Extension: ".docx", MIMEType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Tier: "full"},
		{Extension: ".json", MIMEType: "application/json", Tier: "metadata"},
		{Extension: ".yaml", MIMEType: "application/x-yaml", Tier: "metadata"},
		{Extension: ".csv", MIMEType: "text/csv", Tier: "metadata"},
	},
	ProcessingTiers: []processingTier{
		{Name: "full", Description: "Full text extraction, chunking, and indexing"},
		{Name: "metadata", Description: "Metadata extraction only, no content chunking"},
	},
}

func (a *API) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, capabilities)
}
