package sqlite

func (d *DB) migrateReviewMergeCommit() error {
	return d.addColumnIgnoreDuplicate("ingest_reviews", "merge_commit_sha", "TEXT NOT NULL DEFAULT ''")
}
