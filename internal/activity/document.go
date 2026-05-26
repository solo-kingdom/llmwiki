package activity

import (
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// LogDocument records a document CRUD event.
func LogDocument(db *sqlite.DB, action, docID, relPath, source string) {
	if db == nil {
		return
	}
	msg := fmt.Sprintf("文档 %s", action)
	if relPath != "" {
		msg = fmt.Sprintf("文档 %s：%s", action, relPath)
	}
	Record(db, Entry{
		Level:        "info",
		Category:     "document",
		Action:       action,
		Message:      msg,
		ResourceType: "document",
		ResourceID:   docID,
		Status:       "success",
		Source:       source,
		Details: map[string]interface{}{
			"document_id":   docID,
			"relative_path": relPath,
		},
	})
}
