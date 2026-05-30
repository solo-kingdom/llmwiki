package ingest

import (
	"log"
	"os"
	"path/filepath"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

func (p *JobProcessor) finalizeWikiApply(jobID, archivePath, planJSON string, result ApplyWikiResult) {
	if p.workspace == "" {
		return
	}

	sessionMode := ""
	if archivePath != "" {
		if data, err := os.ReadFile(filepath.Join(p.workspace, archivePath)); err == nil {
			sessionMode = ParseSessionModeFromArchive(string(data))
		}
	}

	moveCount, mergeCount, summary := PlanStructuralCounts(planJSON)
	var idx engine.WikiFileIndexer
	if p.indexer != nil {
		idx = p.indexer
	}

	maint := engine.PostApplyMaintenance(p.workspace, engine.PostApplyMaintenanceOpts{
		WrittenPaths: result.Written,
		DeletedPaths: result.Deleted,
		SessionMode:  sessionMode,
		PlanSummary:  summary,
		MoveCount:    moveCount,
		MergeCount:   mergeCount,
		Indexer:      idx,
	})
	if maint.Warning != "" {
		log.Printf("processor: post-apply maintenance job %s: %s", jobID, maint.Warning)
		if p.db != nil {
			rec := NewSQLiteJobRecorder(p.db, jobID)
			rec.Record("post_apply", "warn", maint.Warning, nil)
		}
	}

	p.indexGeneratedWikiFiles(result.Written, jobID)
	if p.indexer != nil {
		for _, rel := range result.Deleted {
			if err := p.indexer.RemoveFile(rel); err != nil {
				log.Printf("processor: remove index %s after job %s: %v", rel, jobID, err)
			}
		}
	}
}
