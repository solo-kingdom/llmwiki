package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

const revisionSelectColumns = `
	r.id, r.document_id, r.relative_path, r.revision_no, r.parent_revision_id,
	r.change_set_id, r.operation, r.title, r.content, r.metadata, r.content_hash,
	r.source_kind, r.file_type, r.actor, r.created_at`

const changeSetSelectColumns = `
	cs.id, cs.kind, cs.job_id, cs.review_id, cs.source_blob_id, cs.source_filename,
	cs.normalized_content, cs.summary, cs.rollback_of, cs.created_at,
	(SELECT COUNT(*) FROM page_revisions pr WHERE pr.change_set_id = cs.id)`

const revisionDocumentSelect = `
	COALESCE(id, ''), COALESCE(user_id, ''), COALESCE(filename, ''), COALESCE(title, ''),
	COALESCE(path, ''), COALESCE(relative_path, ''), COALESCE(source_kind, ''),
	COALESCE(file_type, ''), COALESCE(file_size, 0), COALESCE(document_number, 0),
	COALESCE(status, ''), COALESCE(page_count, 0), COALESCE(content, ''),
	COALESCE(tags, '[]'), COALESCE(date, ''), COALESCE(metadata, ''),
	COALESCE(error_message, ''), COALESCE(version, 0), COALESCE(parser, ''),
	COALESCE(content_hash, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
	COALESCE(created_at, ''), COALESCE(updated_at, ''), COALESCE(deleted_at, '')`

// ApplyChangeSet writes one atomic page mutation set plus its history.
func (d *DB) ApplyChangeSet(cs *store.ChangeSet, writes []store.PageWrite) error {
	if cs == nil {
		return fmt.Errorf("nil change set")
	}
	if cs.Kind == "" {
		return fmt.Errorf("change set kind is required")
	}
	ctx := context.Background()
	return d.withTx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx); err != nil {
			return err
		}
		if cs.ID == "" {
			cs.ID = uuid.New().String()
		}
		if err := insertChangeSet(ctx, tx, cs); err != nil {
			return err
		}
		for _, w := range writes {
			if err := applyPageWrite(ctx, tx, cs.ID, cs.Kind, w); err != nil {
				return fmt.Errorf("apply page %s: %w", writePath(w), err)
			}
		}
		return nil
	})
}

func writePath(w store.PageWrite) string {
	if w.Document != nil {
		return w.Document.RelativePath
	}
	return w.RelativePath
}

func insertChangeSet(ctx context.Context, tx pgx.Tx, cs *store.ChangeSet) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO change_sets (id, kind, job_id, review_id, source_blob_id, source_filename,
			normalized_content, summary, rollback_of)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		cs.ID, cs.Kind, cs.JobID, cs.ReviewID, cs.SourceBlobID, cs.SourceFilename,
		cs.NormalizedContent, cs.Summary, cs.RollbackOf)
	return err
}

func actorForKind(kind string) string {
	switch kind {
	case "ingest":
		return "ingest"
	case "review_apply":
		return "review"
	case "rollback":
		return "rollback"
	case "import":
		return "migration"
	default:
		return "api"
	}
}

func applyPageWrite(ctx context.Context, tx pgx.Tx, changeSetID, kind string, w store.PageWrite) error {
	relPath := writePath(w)
	if relPath == "" {
		return fmt.Errorf("relative path is required")
	}

	existingID := ""
	if w.Document != nil {
		existingID = w.Document.ID
	}
	existing, err := findDocumentForUpdate(ctx, tx, existingID, relPath)
	if err != nil {
		return err
	}

	var doc store.Document
	if w.Document != nil {
		doc = *w.Document
	} else {
		if existing == nil {
			return fmt.Errorf("document not found: %s", relPath)
		}
		doc = *existing
	}

	if w.Document == nil {
		if existing == nil {
			return fmt.Errorf("document not found: %s", relPath)
		}
		if _, err := tx.Exec(ctx, `UPDATE documents SET deleted_at = (`+nowText+`), updated_at = (`+nowText+`) WHERE id = $1`, existing.ID); err != nil {
			return fmt.Errorf("soft delete document: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM document_chunks WHERE document_id = $1`, existing.ID); err != nil {
			return fmt.Errorf("delete chunks: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM document_references WHERE source_document_id = $1`, existing.ID); err != nil {
			return fmt.Errorf("delete references: %w", err)
		}
		op := w.Operation
		if op == "" {
			op = store.RevisionDelete
		}
		return insertRevision(ctx, tx, changeSetID, kind, existing.ID, relPath, op, *existing)
	}

	doc.RelativePath = relPath
	if doc.Path == "" {
		doc.Path = pathDir(relPath)
	}
	if doc.Filename == "" {
		doc.Filename = path.Base(relPath)
	}
	if doc.UserID == "" {
		doc.UserID = "default"
	}
	if doc.Status == "" {
		doc.Status = "ready"
	}
	if len(doc.Tags) == 0 && doc.Tags == nil {
		doc.Tags = []string{}
	}

	if existing == nil {
		if doc.ID == "" {
			doc.ID = uuid.New().String()
		}
		if doc.DocumentNumber == 0 {
			if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(document_number), 0) + 1 FROM documents`).Scan(&doc.DocumentNumber); err != nil {
				return fmt.Errorf("next document number: %w", err)
			}
		}
		tagsJSON, err := json.Marshal(doc.Tags)
		if err != nil {
			return fmt.Errorf("marshal tags: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO documents (id, user_id, filename, title, path, relative_path, source_kind,
				file_type, file_size, document_number, status, page_count, content, tags, date,
				metadata, error_message, version, parser, content_hash, stale_since, highlights,
				deleted_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'',`+nowText+`,`+nowText+`)`,
			doc.ID, doc.UserID, doc.Filename, doc.Title, doc.Path, doc.RelativePath,
			doc.SourceKind, doc.FileType, doc.FileSize, doc.DocumentNumber, doc.Status,
			doc.PageCount, doc.Content, string(tagsJSON), doc.Date, doc.Metadata,
			doc.ErrorMessage, doc.Version, doc.Parser, doc.ContentHash, doc.StaleSince,
			doc.Highlights); err != nil {
			return fmt.Errorf("insert document: %w", err)
		}
	} else {
		doc.ID = existing.ID
		if doc.DocumentNumber == 0 {
			doc.DocumentNumber = existing.DocumentNumber
		}
		tagsJSON, err := json.Marshal(doc.Tags)
		if err != nil {
			return fmt.Errorf("marshal tags: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE documents SET user_id=$2, filename=$3, title=$4, path=$5, relative_path=$6,
				source_kind=$7, file_type=$8, file_size=$9, document_number=$10, status=$11,
				page_count=$12, content=$13, tags=$14, date=$15, metadata=$16, error_message=$17,
				version=$18, parser=$19, content_hash=$20, stale_since=$21, highlights=$22,
				deleted_at='', updated_at=(`+nowText+`)
			WHERE id=$1`,
			doc.ID, doc.UserID, doc.Filename, doc.Title, doc.Path, doc.RelativePath,
			doc.SourceKind, doc.FileType, doc.FileSize, doc.DocumentNumber, doc.Status,
			doc.PageCount, doc.Content, string(tagsJSON), doc.Date, doc.Metadata,
			doc.ErrorMessage, existing.Version+1, doc.Parser, doc.ContentHash, doc.StaleSince,
			doc.Highlights); err != nil {
			return fmt.Errorf("update document: %w", err)
		}
		doc.Version = existing.Version + 1
	}

	op := w.Operation
	if op == "" {
		if existing == nil {
			op = store.RevisionCreate
		} else {
			op = store.RevisionUpdate
		}
	}
	if err := insertRevision(ctx, tx, changeSetID, kind, doc.ID, relPath, op, doc); err != nil {
		return err
	}
	if err := replaceChunks(ctx, tx, doc.ID, w.Chunks); err != nil {
		return err
	}
	return replaceRefs(ctx, tx, doc.ID, w.Refs)
}

func findDocumentForUpdate(ctx context.Context, tx pgx.Tx, id, relPath string) (*store.Document, error) {
	var row pgx.Row
	if id != "" {
		row = tx.QueryRow(ctx, `SELECT `+revisionDocumentSelect+` FROM documents WHERE id=$1 FOR UPDATE`, id)
	} else {
		row = tx.QueryRow(ctx, `SELECT `+revisionDocumentSelect+` FROM documents WHERE relative_path=$1 FOR UPDATE`, relPath)
	}
	doc, err := scanRevisionDocument(row)
	if err != nil {
		if !isNoRows(err) {
			return nil, err
		}
		if id != "" {
			row = tx.QueryRow(ctx, `SELECT `+revisionDocumentSelect+` FROM documents WHERE relative_path=$1 FOR UPDATE`, relPath)
			doc, err = scanRevisionDocument(row)
			if err != nil && !isNoRows(err) {
				return nil, err
			}
			if isNoRows(err) {
				return nil, nil
			}
			return doc, nil
		}
		return nil, nil
	}
	return doc, nil
}

func scanRevisionDocument(scanner interface{ Scan(...any) error }) (*store.Document, error) {
	var doc store.Document
	var tagsJSON string
	if err := scanner.Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path, &doc.RelativePath,
		&doc.SourceKind, &doc.FileType, &doc.FileSize, &doc.DocumentNumber, &doc.Status,
		&doc.PageCount, &doc.Content, &tagsJSON, &doc.Date, &doc.Metadata, &doc.ErrorMessage,
		&doc.Version, &doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt, &doc.DeletedAt,
	); err != nil {
		return nil, err
	}
	if strings.TrimSpace(tagsJSON) != "" {
		_ = json.Unmarshal([]byte(tagsJSON), &doc.Tags)
	}
	return &doc, nil
}

func insertRevision(ctx context.Context, tx pgx.Tx, changeSetID, kind, documentID, relPath string, op store.RevisionOperation, doc store.Document) error {
	parentID := ""
	revisionNo := 1
	var parentNo int
	err := tx.QueryRow(ctx, `SELECT id, revision_no FROM page_revisions WHERE document_id=$1 ORDER BY revision_no DESC LIMIT 1`, documentID).Scan(&parentID, &parentNo)
	if err != nil && !isNoRows(err) {
		return fmt.Errorf("latest revision: %w", err)
	}
	if parentNo > 0 {
		revisionNo = parentNo + 1
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO page_revisions (id, document_id, relative_path, revision_no, parent_revision_id,
			change_set_id, operation, title, content, metadata, content_hash, source_kind,
			file_type, actor)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		uuid.New().String(), documentID, relPath, revisionNo, parentID, changeSetID,
		string(op), doc.Title, doc.Content, doc.Metadata, doc.ContentHash, doc.SourceKind,
		doc.FileType, actorForKind(kind))
	return err
}

func replaceChunks(ctx context.Context, tx pgx.Tx, docID string, chunks []store.Chunk) error {
	if _, err := tx.Exec(ctx, `DELETE FROM document_chunks WHERE document_id=$1`, docID); err != nil {
		return fmt.Errorf("delete chunks: %w", err)
	}
	for _, c := range chunks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO document_chunks (id, document_id, chunk_index, content, page, start_char, token_count, header_breadcrumb)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			uuid.New().String(), docID, c.ChunkIndex, c.Content, c.Page, c.StartChar, c.TokenCount, c.HeaderBreadcrumb); err != nil {
			return fmt.Errorf("insert chunk %d: %w", c.ChunkIndex, err)
		}
	}
	return nil
}

func replaceRefs(ctx context.Context, tx pgx.Tx, sourceID string, refs []store.RefEdge) error {
	if _, err := tx.Exec(ctx, `DELETE FROM document_references WHERE source_document_id=$1`, sourceID); err != nil {
		return fmt.Errorf("delete references: %w", err)
	}
	for _, e := range refs {
		var page any
		if e.Page != nil {
			page = *e.Page
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
			VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (source_document_id, target_document_id, reference_type) DO NOTHING`,
			uuid.New().String(), e.SourceID, e.TargetID, e.RefType, page); err != nil {
			return fmt.Errorf("insert reference: %w", err)
		}
	}
	return nil
}

func pathDir(relPath string) string {
	dir := path.Dir(relPath)
	if dir == "." || dir == "/" {
		return "/"
	}
	return "/" + strings.TrimPrefix(dir, "/") + "/"
}

func (d *DB) GetChangeSet(id string) (*store.ChangeSet, error) {
	row := d.pool.QueryRow(context.Background(), `SELECT `+changeSetSelectColumns+` FROM change_sets cs WHERE cs.id=$1`, id)
	cs, err := scanChangeSet(row)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return cs, nil
}

func scanChangeSet(scanner interface{ Scan(...any) error }) (*store.ChangeSet, error) {
	var cs store.ChangeSet
	if err := scanner.Scan(
		&cs.ID, &cs.Kind, &cs.JobID, &cs.ReviewID, &cs.SourceBlobID, &cs.SourceFilename,
		&cs.NormalizedContent, &cs.Summary, &cs.RollbackOf, &cs.CreatedAt, &cs.PageCount,
	); err != nil {
		return nil, err
	}
	return &cs, nil
}

func (d *DB) ListChangeSets(limit int, before string) ([]store.ChangeSet, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	ctx := context.Background()
	rows, err := d.pool.Query(ctx, `SELECT `+changeSetSelectColumns+` FROM change_sets cs
		WHERE ($1 = '' OR cs.created_at < $1) ORDER BY cs.created_at DESC, cs.id DESC LIMIT $2`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.ChangeSet
	for rows.Next() {
		cs, err := scanChangeSet(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *cs)
	}
	return out, rows.Err()
}

func (d *DB) ListChangeSetRevisions(changeSetID string) ([]store.PageRevision, error) {
	return d.queryRevisions(context.Background(), `WHERE r.change_set_id=$1 ORDER BY r.relative_path, r.revision_no`, changeSetID)
}

func (d *DB) ListPageRevisions(relativePath string, limit int) ([]store.PageRevision, error) {
	if limit <= 0 {
		limit = 100
	}
	return d.queryRevisions(context.Background(), `WHERE r.relative_path=$1 ORDER BY r.revision_no DESC LIMIT $2`, relativePath, limit)
}

func (d *DB) queryRevisions(ctx context.Context, suffix string, args ...any) ([]store.PageRevision, error) {
	rows, err := d.pool.Query(ctx, `SELECT `+revisionSelectColumns+` FROM page_revisions r `+suffix, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.PageRevision
	for rows.Next() {
		rev, err := scanRevision(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rev)
	}
	return out, rows.Err()
}

func scanRevision(scanner interface{ Scan(...any) error }) (*store.PageRevision, error) {
	var rev store.PageRevision
	var op string
	if err := scanner.Scan(
		&rev.ID, &rev.DocumentID, &rev.RelativePath, &rev.RevisionNo, &rev.ParentRevisionID,
		&rev.ChangeSetID, &op, &rev.Title, &rev.Content, &rev.Metadata, &rev.ContentHash,
		&rev.SourceKind, &rev.FileType, &rev.Actor, &rev.CreatedAt,
	); err != nil {
		return nil, err
	}
	rev.Operation = store.RevisionOperation(op)
	return &rev, nil
}

func (d *DB) LatestRevision(documentID string) (*store.PageRevision, error) {
	row := d.pool.QueryRow(context.Background(), `SELECT `+revisionSelectColumns+`
		FROM page_revisions r WHERE r.document_id=$1 ORDER BY r.revision_no DESC LIMIT 1`, documentID)
	rev, err := scanRevision(row)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return rev, nil
}

func (d *DB) GetRevision(id string) (*store.PageRevision, error) {
	row := d.pool.QueryRow(context.Background(), `SELECT `+revisionSelectColumns+` FROM page_revisions r WHERE r.id=$1`, id)
	rev, err := scanRevision(row)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return rev, nil
}

// UndoChangeSet restores every page touched by the change set to its parent revision.
func (d *DB) UndoChangeSet(changeSetID, actor string) (*store.ChangeSet, error) {
	ctx := context.Background()
	var result *store.ChangeSet
	err := d.withTx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx); err != nil {
			return err
		}
		target, err := scanChangeSet(tx.QueryRow(ctx, `SELECT `+changeSetSelectColumns+` FROM change_sets cs WHERE cs.id=$1`, changeSetID))
		if err != nil {
			return fmt.Errorf("load change set: %w", err)
		}
		revs, err := collectRevisions(ctx, tx, `WHERE r.change_set_id=$1 ORDER BY r.document_id, r.revision_no`, changeSetID)
		if err != nil {
			return err
		}
		latest := latestPerDocument(revs)
		newCS := &store.ChangeSet{
			ID:         uuid.New().String(),
			Kind:       "rollback",
			RollbackOf: changeSetID,
			Summary:    "rollback: " + target.Summary,
		}
		if err := insertChangeSet(ctx, tx, newCS); err != nil {
			return err
		}
		for _, rev := range latest {
			w, err := undoWriteFor(ctx, tx, rev)
			if err != nil {
				return err
			}
			if err := applyPageWrite(ctx, tx, newCS.ID, newCS.Kind, w); err != nil {
				return fmt.Errorf("undo %s: %w", rev.RelativePath, err)
			}
			newCS.PageCount++
		}
		result = newCS
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result != nil {
		result.CreatedAt = nowString()
	}
	return result, nil
}

func collectRevisions(ctx context.Context, tx pgx.Tx, suffix string, args ...any) ([]store.PageRevision, error) {
	rows, err := tx.Query(ctx, `SELECT `+revisionSelectColumns+` FROM page_revisions r `+suffix, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.PageRevision
	for rows.Next() {
		rev, err := scanRevision(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rev)
	}
	return out, rows.Err()
}

func latestPerDocument(revs []store.PageRevision) []store.PageRevision {
	byDoc := map[string]store.PageRevision{}
	for _, rev := range revs {
		if prev, ok := byDoc[rev.DocumentID]; !ok || rev.RevisionNo > prev.RevisionNo {
			byDoc[rev.DocumentID] = rev
		}
	}
	out := make([]store.PageRevision, 0, len(byDoc))
	for _, rev := range byDoc {
		out = append(out, rev)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RelativePath < out[j].RelativePath })
	return out
}

func undoWriteFor(ctx context.Context, tx pgx.Tx, rev store.PageRevision) (store.PageWrite, error) {
	if rev.Operation == store.RevisionCreate || rev.ParentRevisionID == "" {
		return store.PageWrite{RelativePath: rev.RelativePath, Operation: store.RevisionDelete}, nil
	}
	parent, err := scanRevision(tx.QueryRow(ctx, `SELECT `+revisionSelectColumns+` FROM page_revisions r WHERE r.id=$1`, rev.ParentRevisionID))
	if err != nil {
		if isNoRows(err) {
			return store.PageWrite{RelativePath: rev.RelativePath, Operation: store.RevisionDelete}, nil
		}
		return store.PageWrite{}, err
	}
	return store.PageWrite{
		RelativePath: rev.RelativePath,
		Document:     documentFromRevision(*parent),
		Operation:    store.RevisionRestore,
	}, nil
}

// RestoreRevision writes a new revision equal to the requested one.
func (d *DB) RestoreRevision(revisionID, actor string) (*store.ChangeSet, error) {
	ctx := context.Background()
	var result *store.ChangeSet
	err := d.withTx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx); err != nil {
			return err
		}
		rev, err := scanRevision(tx.QueryRow(ctx, `SELECT `+revisionSelectColumns+` FROM page_revisions r WHERE r.id=$1`, revisionID))
		if err != nil {
			return fmt.Errorf("load revision: %w", err)
		}
		newCS := &store.ChangeSet{
			ID:         uuid.New().String(),
			Kind:       "rollback",
			RollbackOf: rev.ChangeSetID,
			Summary:    fmt.Sprintf("restore revision %d of %s", rev.RevisionNo, rev.RelativePath),
		}
		if err := insertChangeSet(ctx, tx, newCS); err != nil {
			return err
		}
		w := store.PageWrite{RelativePath: rev.RelativePath, Document: documentFromRevision(*rev), Operation: store.RevisionRestore}
		if rev.Operation == store.RevisionDelete {
			w = store.PageWrite{RelativePath: rev.RelativePath, Operation: store.RevisionDelete}
		}
		if err := applyPageWrite(ctx, tx, newCS.ID, newCS.Kind, w); err != nil {
			return err
		}
		newCS.PageCount = 1
		result = newCS
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result != nil {
		result.CreatedAt = nowString()
	}
	return result, nil
}

func documentFromRevision(rev store.PageRevision) *store.Document {
	return &store.Document{
		ID:           rev.DocumentID,
		UserID:       "default",
		Filename:     path.Base(rev.RelativePath),
		Title:        rev.Title,
		Path:         pathDir(rev.RelativePath),
		RelativePath: rev.RelativePath,
		SourceKind:   rev.SourceKind,
		FileType:     rev.FileType,
		Status:       "ready",
		Content:      rev.Content,
		Metadata:     rev.Metadata,
		ContentHash:  rev.ContentHash,
		Tags:         []string{},
	}
}

func nowString() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05")
}
