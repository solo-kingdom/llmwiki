package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// SeedInitialRevisions creates one import revision for every live document
// that has no history yet. It is idempotent.
func (d *DB) SeedInitialRevisions(actor string) (int, error) {
	if actor == "" {
		actor = "migration"
	}
	ctx := context.Background()
	count := 0
	err := d.withTx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT d.id, d.relative_path, COALESCE(d.title,''), COALESCE(d.content,''),
				COALESCE(d.metadata,''), COALESCE(d.content_hash,''), COALESCE(d.source_kind,''),
				COALESCE(d.file_type,'')
			FROM documents d
			WHERE COALESCE(d.deleted_at,'') = ''
			  AND NOT EXISTS (SELECT 1 FROM page_revisions r WHERE r.document_id = d.id)`)
		if err != nil {
			return err
		}
		type rowData struct {
			id, rel, title, content, metadata, hash, kind, ftype string
		}
		var docs []rowData
		for rows.Next() {
			var r rowData
			if err := rows.Scan(&r.id, &r.rel, &r.title, &r.content, &r.metadata, &r.hash, &r.kind, &r.ftype); err != nil {
				rows.Close()
				return err
			}
			docs = append(docs, r)
		}
		rows.Close()
		if len(docs) == 0 {
			return nil
		}
		cs := &store.ChangeSet{ID: uuid.New().String(), Kind: "import", Summary: fmt.Sprintf("import %d page(s)", len(docs))}
		if err := insertChangeSet(ctx, tx, cs); err != nil {
			return err
		}
		for _, r := range docs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO page_revisions (id, document_id, relative_path, revision_no, parent_revision_id,
					change_set_id, operation, title, content, metadata, content_hash, source_kind, file_type, actor)
				VALUES ($1,$2,$3,1,'',$4,'create',$5,$6,$7,$8,$9,$10,$11)`,
				uuid.New().String(), r.id, r.rel, cs.ID, r.title, r.content, r.metadata, r.hash, r.kind, r.ftype, actor); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	return count, err
}
