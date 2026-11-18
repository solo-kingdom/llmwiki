package postgres

import (
	"context"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// ListWikiGraphEdges returns links_to edges as source->target relative paths.
func (d *DB) ListWikiGraphEdges() ([]store.GraphEdge, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT src.relative_path, tgt.relative_path, dr.reference_type
		FROM document_references dr
		JOIN documents src ON dr.source_document_id = src.id
		JOIN documents tgt ON dr.target_document_id = tgt.id
		WHERE dr.reference_type = 'links_to'
		  AND src.status != 'failed' AND tgt.status != 'failed'
		  AND COALESCE(src.deleted_at, '') = '' AND COALESCE(tgt.deleted_at, '') = ''
		  AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
		  AND src.relative_path != '' AND tgt.relative_path != ''`)
	if err != nil {
		return nil, fmt.Errorf("list wiki graph edges: %w", err)
	}
	defer rows.Close()

	var out []store.GraphEdge
	for rows.Next() {
		var e store.GraphEdge
		if err := rows.Scan(&e.Source, &e.Target, &e.Type); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// BuildKnowledgeGraph returns wiki page nodes and links_to edges for visualization.
// Hidden wiki subdirectories (templates, sources) are excluded from both nodes and edges.
// When limit > 0, only the top-N nodes by link count are returned, along with edges
// between those nodes. TotalNodes and Truncated reflect the full dataset.
func (d *DB) BuildKnowledgeGraph(limit int) (*store.GraphData, error) {
	ctx := context.Background()
	hiddenExclude := "AND NOT (" + hiddenSubdirsWhere("d.relative_path") + ") "

	// First pass: count links per node to compute link_count and enable ranking.
	countRows, err := d.pool.Query(ctx, `
		SELECT d.relative_path, COUNT(*) AS cnt
		FROM documents d
		LEFT JOIN document_references dr ON (
			(dr.source_document_id = d.id OR dr.target_document_id = d.id)
			AND dr.reference_type = 'links_to'
		)
		WHERE d.source_kind = 'wiki' AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
		  AND d.relative_path != ''
		`+hiddenExclude+`
		GROUP BY d.relative_path
		ORDER BY cnt DESC, d.relative_path`)
	if err != nil {
		return nil, fmt.Errorf("count graph links: %w", err)
	}
	defer countRows.Close()

	type nodeRow struct {
		relPath   string
		linkCount int
	}
	var allRows []nodeRow
	for countRows.Next() {
		var r nodeRow
		if err := countRows.Scan(&r.relPath, &r.linkCount); err != nil {
			return nil, fmt.Errorf("scan graph link count: %w", err)
		}
		allRows = append(allRows, r)
	}
	if err := countRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate graph link counts: %w", err)
	}

	totalNodes := len(allRows)
	truncated := limit > 0 && totalNodes > limit
	if limit <= 0 || totalNodes <= limit {
		limit = totalNodes
	}

	// Build the set of selected paths for edge filtering.
	selectedPaths := make(map[string]bool, limit)
	for i := 0; i < limit; i++ {
		selectedPaths[allRows[i].relPath] = true
	}

	// Fetch document details for selected nodes.
	nodes := make([]store.GraphNode, 0, limit)
	for i := 0; i < limit; i++ {
		r := allRows[i]
		var docID, title string
		err := d.pool.QueryRow(ctx,
			`SELECT id, COALESCE(title, '') FROM documents d
			 WHERE d.relative_path = $1 AND COALESCE(d.deleted_at, '') = ''`, r.relPath,
		).Scan(&docID, &title)
		if err != nil {
			return nil, fmt.Errorf("get doc for %s: %w", r.relPath, err)
		}
		nodes = append(nodes, store.GraphNode{
			ID:         r.relPath,
			DocumentID: docID,
			Title:      title,
			Type:       engine.WikiPageType(r.relPath),
			LinkCount:  r.linkCount,
		})
	}

	// Fetch edges between selected nodes only.
	edgeRows, err := d.pool.Query(ctx, `
		SELECT src.relative_path, tgt.relative_path, dr.reference_type
		FROM document_references dr
		JOIN documents src ON dr.source_document_id = src.id
		JOIN documents tgt ON dr.target_document_id = tgt.id
		WHERE dr.reference_type = 'links_to'
		  AND src.status != 'failed' AND tgt.status != 'failed'
		  AND COALESCE(src.deleted_at, '') = '' AND COALESCE(tgt.deleted_at, '') = ''
		  AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
		  AND src.relative_path != '' AND tgt.relative_path != ''
		  AND NOT (`+hiddenSubdirsWhere("src.relative_path")+`)
		  AND NOT (`+hiddenSubdirsWhere("tgt.relative_path")+`)
		ORDER BY src.relative_path, tgt.relative_path`)
	if err != nil {
		return nil, fmt.Errorf("list graph edges: %w", err)
	}
	defer edgeRows.Close()

	edges := make([]store.GraphEdge, 0)
	for edgeRows.Next() {
		var source, target, refType string
		if err := edgeRows.Scan(&source, &target, &refType); err != nil {
			return nil, fmt.Errorf("scan graph edge: %w", err)
		}
		if selectedPaths[source] && selectedPaths[target] {
			edges = append(edges, store.GraphEdge{
				Source: source,
				Target: target,
				Type:   refType,
			})
		}
	}
	if err := edgeRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate graph edges: %w", err)
	}

	return &store.GraphData{Nodes: nodes, Edges: edges, TotalNodes: totalNodes, Truncated: truncated}, nil
}
