package activity

import (
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// Indexer wraps a file indexer and records index_failed on errors.
type Indexer struct {
	Inner interface {
		IndexFile(relPath string) error
		UpdateFile(relPath string) error
		RemoveFile(relPath string) error
	}
	DB *sqlite.DB
}

func (w *Indexer) IndexFile(relPath string) error {
	err := w.Inner.IndexFile(relPath)
	if err != nil {
		RecordIndexFailed(w.DB, relPath, err)
	}
	return err
}

func (w *Indexer) UpdateFile(relPath string) error {
	err := w.Inner.UpdateFile(relPath)
	if err != nil {
		RecordIndexFailed(w.DB, relPath, err)
	}
	return err
}

func (w *Indexer) RemoveFile(relPath string) error {
	err := w.Inner.RemoveFile(relPath)
	if err != nil {
		RecordIndexFailed(w.DB, relPath, err)
	}
	return err
}
