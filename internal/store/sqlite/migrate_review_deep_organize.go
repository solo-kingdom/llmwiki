package sqlite

func (d *DB) migrateReviewDeepOrganize() error {
	return d.addColumnIgnoreDuplicate("ingest_reviews", "deep_organize", "BOOLEAN NOT NULL DEFAULT FALSE")
}
