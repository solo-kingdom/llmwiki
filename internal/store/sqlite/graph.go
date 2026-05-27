package sqlite

import (
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

// GraphNode is a wiki page node for the knowledge graph API.
type GraphNode struct {
	ID         string `json:"id"`
	DocumentID string `json:"document_id"`
	Title      string `json:"title"`
	Type       string `json:"type"`
	LinkCount  int    `json:"link_count"`
}

// GraphEdge is a reference edge for the knowledge graph API.
type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

// GraphData holds nodes and edges for the knowledge graph visualization.
type GraphData struct {
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	TotalNodes int         `json:"total_nodes"`
	Truncated  bool        `json:"truncated"`
}

// BuildKnowledgeGraph returns wiki page nodes and links_to edges for visualization.
// Hidden wiki subdirectories (templates, sources) are excluded from both nodes and edges.
// When limit > 0, only the top-N nodes by link count are returned, along with edges
// between those nodes. TotalNodes and Truncated reflect the full dataset.
func (d *DB) BuildKnowledgeGraph(limit int) (*GraphData, error) {
	hiddenExclude := "AND NOT (" + hiddenSubdirsWhere("d.relative_path") + ") "

	// First pass: count links per node to compute link_count and enable ranking.
	countRows, err := d.db.Query(`
		SELECT d.relative_path, COUNT(*) AS cnt
		FROM documents d
		LEFT JOIN document_references dr ON (
			(dr.source_document_id = d.id OR dr.target_document_id = d.id)
			AND dr.reference_type = 'links_to'
		)
		WHERE d.source_kind = 'wiki' AND d.status != 'failed' AND d.relative_path != ''
		` + hiddenExclude +
		`GROUP BY d.relative_path
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
	for i := range limit {
		selectedPaths[allRows[i].relPath] = true
	}

	// Fetch document details for selected nodes.
	pathToDocID := make(map[string]string, limit)
	var nodes []GraphNode
	for i := range limit {
		r := allRows[i]
		var docID, title string
		err := d.db.QueryRow(
			`SELECT id, title FROM documents WHERE relative_path = ?`, r.relPath,
		).Scan(&docID, &title)
		if err != nil {
			return nil, fmt.Errorf("get doc for %s: %w", r.relPath, err)
		}
		pathToDocID[r.relPath] = docID
		nodes = append(nodes, GraphNode{
			ID:         r.relPath,
			DocumentID: docID,
			Title:      title,
			Type:       engine.WikiPageType(r.relPath),
			LinkCount:  r.linkCount,
		})
	}

	// Fetch edges between selected nodes only.
	edgeRows, err := d.db.Query(`
		SELECT src.relative_path, tgt.relative_path, dr.reference_type
		FROM document_references dr
		JOIN documents src ON dr.source_document_id = src.id
		JOIN documents tgt ON dr.target_document_id = tgt.id
		WHERE dr.reference_type = 'links_to'
		  AND src.status != 'failed' AND tgt.status != 'failed'
		  AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
		  AND src.relative_path != '' AND tgt.relative_path != ''
		  AND NOT (` + hiddenSubdirsWhere("src.relative_path") + `)
		  AND NOT (` + hiddenSubdirsWhere("tgt.relative_path") + `)
		ORDER BY src.relative_path, tgt.relative_path`)
	if err != nil {
		return nil, fmt.Errorf("list graph edges: %w", err)
	}
	defer edgeRows.Close()

	var edges []GraphEdge
	for edgeRows.Next() {
		var source, target, refType string
		if err := edgeRows.Scan(&source, &target, &refType); err != nil {
			return nil, fmt.Errorf("scan graph edge: %w", err)
		}
		if selectedPaths[source] && selectedPaths[target] {
			edges = append(edges, GraphEdge{
				Source: source,
				Target: target,
				Type:   refType,
			})
		}
	}
	if err := edgeRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate graph edges: %w", err)
	}

	if nodes == nil {
		nodes = []GraphNode{}
	}
	if edges == nil {
		edges = []GraphEdge{}
	}

	return &GraphData{Nodes: nodes, Edges: edges, TotalNodes: totalNodes, Truncated: truncated}, nil
}
