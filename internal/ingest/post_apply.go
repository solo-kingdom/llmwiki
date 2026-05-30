package ingest

import (
	"log"
	"os"
	"path/filepath"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

const wikiMaintenanceCommitMsg = "wiki: post-apply maintenance"

func (p *JobProcessor) postApplyMaintenanceOpts(archivePath, planJSON string, result ApplyWikiResult, indexer engine.WikiFileIndexer) engine.PostApplyMaintenanceOpts {
	sessionMode := ""
	if archivePath != "" && p.workspace != "" {
		if data, err := os.ReadFile(filepath.Join(p.workspace, archivePath)); err == nil {
			sessionMode = ParseSessionModeFromArchive(string(data))
		}
	}
	moveCount, mergeCount, summary := PlanStructuralCounts(planJSON)
	return engine.PostApplyMaintenanceOpts{
		WrittenPaths: result.Written,
		DeletedPaths: result.Deleted,
		SessionMode:  sessionMode,
		PlanSummary:  summary,
		MoveCount:    moveCount,
		MergeCount:   mergeCount,
		Indexer:      indexer,
	}
}

func (p *JobProcessor) runPostApplyMaintenance(workspace, archivePath, planJSON string, result ApplyWikiResult, indexer engine.WikiFileIndexer) engine.PostApplyMaintenanceResult {
	if workspace == "" {
		return engine.PostApplyMaintenanceResult{}
	}
	return engine.PostApplyMaintenance(workspace, p.postApplyMaintenanceOpts(archivePath, planJSON, result, indexer))
}

func (p *JobProcessor) commitWikiMaintenance(jobID, warnContext string) {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		return
	}
	if _, err := repo.CommitWikiMaintenance(wikiMaintenanceCommitMsg); err != nil {
		msg := "commit wiki maintenance: " + err.Error()
		log.Printf("processor: %s job %s: %s", warnContext, jobID, msg)
		if p.db != nil {
			rec := NewSQLiteJobRecorder(p.db, jobID)
			rec.Record("post_apply", "warn", msg, nil)
		}
	}
}

func (p *JobProcessor) finalizeWikiApply(jobID, archivePath, planJSON string, result ApplyWikiResult) {
	if p.workspace == "" {
		return
	}

	var idx engine.WikiFileIndexer
	if p.indexer != nil {
		idx = p.indexer
	}

	maint := p.runPostApplyMaintenance(p.workspace, archivePath, planJSON, result, idx)
	if maint.Warning != "" {
		log.Printf("processor: post-apply maintenance job %s: %s", jobID, maint.Warning)
		if p.db != nil {
			rec := NewSQLiteJobRecorder(p.db, jobID)
			rec.Record("post_apply", "warn", maint.Warning, nil)
		}
	}

	p.commitWikiMaintenance(jobID, "post-apply maintenance")

	p.indexGeneratedWikiFiles(result.Written, jobID)
	if p.indexer != nil {
		for _, rel := range result.Deleted {
			if err := p.indexer.RemoveFile(rel); err != nil {
				log.Printf("processor: remove index %s after job %s: %v", rel, jobID, err)
			}
		}
	}
}
