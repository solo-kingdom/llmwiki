import type { Pool } from "pg";
import { wikiPageType } from "../../engine/wiki_org.js";
import type { IndexStore } from "../interfaces.js";
import type { GraphData, GraphEdge, GraphNode } from "../types.js";
import { hiddenSubdirsWhere } from "./documents.js";
import { asNumber, asString, queryOne, queryRows } from "./sql.js";

export function graphRepo(
  pool: Pool,
): Pick<IndexStore, "listWikiGraphEdges" | "buildKnowledgeGraph"> {
  return {
    async listWikiGraphEdges(): Promise<GraphEdge[]> {
      const rows = await queryRows(
        pool,
        `SELECT src.relative_path, tgt.relative_path, dr.reference_type
         FROM document_references dr
         JOIN documents src ON dr.source_document_id = src.id
         JOIN documents tgt ON dr.target_document_id = tgt.id
         WHERE dr.reference_type = 'links_to'
           AND src.status != 'failed' AND tgt.status != 'failed'
           AND COALESCE(src.deleted_at, '') = '' AND COALESCE(tgt.deleted_at, '') = ''
           AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
           AND src.relative_path != '' AND tgt.relative_path != ''`,
      );
      return rows.map((row) => ({
        source: asString(row[0]),
        target: asString(row[1]),
        type: asString(row[2]),
      }));
    },

    async buildKnowledgeGraph(limit: number): Promise<GraphData> {
      const hiddenExclude = `AND NOT (${hiddenSubdirsWhere("d.relative_path")}) `;
      const countRows = await queryRows<[string, number]>(
        pool,
        `SELECT d.relative_path, COUNT(*) AS cnt
         FROM documents d
         LEFT JOIN document_references dr ON (
           (dr.source_document_id = d.id OR dr.target_document_id = d.id)
           AND dr.reference_type = 'links_to'
         )
         WHERE d.source_kind = 'wiki' AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
           AND d.relative_path != ''
           ${hiddenExclude}
         GROUP BY d.relative_path
         ORDER BY cnt DESC, d.relative_path`,
      );
      const allRows = countRows.map((row) => ({
        relPath: asString(row[0]),
        linkCount: asNumber(row[1]),
      }));

      const totalNodes = allRows.length;
      const truncated = limit > 0 && totalNodes > limit;
      const effectiveLimit = limit <= 0 || totalNodes <= limit ? totalNodes : limit;

      const selectedPaths = new Set(allRows.slice(0, effectiveLimit).map((row) => row.relPath));

      const nodes: GraphNode[] = [];
      for (const row of allRows.slice(0, effectiveLimit)) {
        const doc = await queryOne<[string, string]>(
          pool,
          `SELECT id, COALESCE(title, '') FROM documents d
           WHERE d.relative_path = $1 AND COALESCE(d.deleted_at, '') = ''`,
          [row.relPath],
        );
        if (!doc) continue;
        nodes.push({
          id: row.relPath,
          document_id: asString(doc[0]),
          title: asString(doc[1]),
          type: wikiPageType(row.relPath),
          link_count: row.linkCount,
        });
      }

      const edgeRows = await queryRows(
        pool,
        `SELECT src.relative_path, tgt.relative_path, dr.reference_type
         FROM document_references dr
         JOIN documents src ON dr.source_document_id = src.id
         JOIN documents tgt ON dr.target_document_id = tgt.id
         WHERE dr.reference_type = 'links_to'
           AND src.status != 'failed' AND tgt.status != 'failed'
           AND COALESCE(src.deleted_at, '') = '' AND COALESCE(tgt.deleted_at, '') = ''
           AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
           AND src.relative_path != '' AND tgt.relative_path != ''
           AND NOT (${hiddenSubdirsWhere("src.relative_path")})
           AND NOT (${hiddenSubdirsWhere("tgt.relative_path")})
         ORDER BY src.relative_path, tgt.relative_path`,
      );
      const edges: GraphEdge[] = edgeRows
        .map((row) => ({
          source: asString(row[0]),
          target: asString(row[1]),
          type: asString(row[2]),
        }))
        .filter((edge) => selectedPaths.has(edge.source) && selectedPaths.has(edge.target));

      return { nodes, edges, total_nodes: totalNodes, truncated };
    },
  };
}
