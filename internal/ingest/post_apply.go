package ingest

import "fmt"

// finalizeWikiApply records the apply outcome. Page content, chunks and references
// are already persisted by the DB-first apply path; there is no file maintenance.
func (p *JobProcessor) finalizeWikiApply(jobID, archivePath, planJSON string, result ApplyWikiResult) {
	if p.db == nil {
		return
	}
	rec := NewSQLiteJobRecorder(p.db, jobID)
	rec.Record("post_apply", "complete",
		fmt.Sprintf("applied %d page(s), deleted %d", len(result.Written), len(result.Deleted)), nil)
}
