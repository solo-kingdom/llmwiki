package sqlite

import (
	"fmt"
	"strings"
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
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

var wikiSubdirType = map[string]string{
	"entities":    "entity",
	"concepts":    "concept",
	"sources":     "source",
	"synthesis":   "synthesis",
	"comparisons": "comparison",
	"queries":     "query",
}

func wikiPageType(relPath string) string {
	parts := strings.Split(strings.Trim(relPath, "/"), "/")
	if len(parts) >= 2 {
		if t, ok := wikiSubdirType[parts[1]]; ok {
			return t
		}
	}
	return "page"
}

// BuildKnowledgeGraph returns wiki page nodes and links_to edges for visualization.
func (d *DB) BuildKnowledgeGraph() (*GraphData, error) {
	rows, err := d.db.Query(`
		SELECT d.id, d.relative_path, d.title
		FROM documents d
		WHERE d.source_kind = 'wiki' AND d.status != 'failed' AND d.relative_path != ''
		ORDER BY d.relative_path`)
	if err != nil {
		return nil, fmt.Errorf("list wiki documents: %w", err)
	}
	defer rows.Close()

	pathToDocID := make(map[string]string)
	var nodes []GraphNode
	for rows.Next() {
		var docID, relPath, title string
		if err := rows.Scan(&docID, &relPath, &title); err != nil {
			return nil, fmt.Errorf("scan wiki document: %w", err)
		}
		pathToDocID[relPath] = docID
		nodes = append(nodes, GraphNode{
			ID:         relPath,
			DocumentID: docID,
			Title:      title,
			Type:       wikiPageType(relPath),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate wiki documents: %w", err)
	}

	edgeRows, err := d.db.Query(`
		SELECT src.relative_path, tgt.relative_path, dr.reference_type
		FROM document_references dr
		JOIN documents src ON dr.source_document_id = src.id
		JOIN documents tgt ON dr.target_document_id = tgt.id
		WHERE dr.reference_type = 'links_to'
		  AND src.status != 'failed' AND tgt.status != 'failed'
		  AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
		  AND src.relative_path != '' AND tgt.relative_path != ''
		ORDER BY src.relative_path, tgt.relative_path`)
	if err != nil {
		return nil, fmt.Errorf("list graph edges: %w", err)
	}
	defer edgeRows.Close()

	linkCounts := make(map[string]int)
	var edges []GraphEdge
	for edgeRows.Next() {
		var source, target, refType string
		if err := edgeRows.Scan(&source, &target, &refType); err != nil {
			return nil, fmt.Errorf("scan graph edge: %w", err)
		}
		edges = append(edges, GraphEdge{
			Source: source,
			Target: target,
			Type:   refType,
		})
		linkCounts[source]++
		linkCounts[target]++
	}
	if err := edgeRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate graph edges: %w", err)
	}

	for i := range nodes {
		nodes[i].LinkCount = linkCounts[nodes[i].ID]
	}

	if nodes == nil {
		nodes = []GraphNode{}
	}
	if edges == nil {
		edges = []GraphEdge{}
	}

	return &GraphData{Nodes: nodes, Edges: edges}, nil
}
