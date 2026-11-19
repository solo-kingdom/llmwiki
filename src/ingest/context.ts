import { lintWorkspace } from "../engine/lint.js";
import { LINT_CODE_DEAD_LINK } from "../engine/lint_types.js";
import type { Store } from "../store/interfaces.js";
import type { RelatedSubsetEntry, WikiPageBody, WikiRefInput } from "./types.js";

const MAX_RELATED_SUBSET_ENTRIES = 8;
const MAX_GRAPH_EXPAND_NODES = 20;
const MAX_FTS_SEEDS = 5;
const MAX_WIKI_REF_INJECT_LEN = 120000;

export class ContextResolver {
  constructor(
    private readonly db: Store | null,
    private readonly workspace: string,
  ) {}

  async resolveRelatedSubset(
    userQuery: string,
    refs: WikiRefInput[],
  ): Promise<RelatedSubsetEntry[]> {
    if (!this.db) return [];
    const deadTargets = await this.deadLinkTargets();
    const scores = new Map<string, number>();
    const titles = new Map<string, string>();

    const add = (rawPath: string, rawTitle: string, score: number) => {
      const itemPath = rawPath.trim();
      if (!itemPath || deadTargets.has(itemPath)) return;
      const title = rawTitle || itemPath;
      titles.set(itemPath, title);
      if (score > (scores.get(itemPath) ?? 0)) scores.set(itemPath, score);
    };

    for (const ref of refs) {
      let itemPath = ref.relativePath.trim();
      let title = ref.title.trim();
      if (!itemPath && ref.documentId) {
        const doc = await this.db.getWikiDocumentByID(ref.documentId);
        if (doc) {
          itemPath = doc.relative_path;
          if (!title) title = doc.title;
        }
      }
      add(itemPath, title, 1);
    }

    const query = userQuery.trim();
    if (query) {
      const hits = await this.db.searchChunks(query, MAX_FTS_SEEDS, "wiki");
      hits.forEach((hit, index) => add(hit.path, hit.title, 0.8 - index * 0.05));
    }

    const seedPaths = [...scores.entries()].filter(([, score]) => score >= 0.7).map(([itemPath]) => itemPath);
    if (seedPaths.length > 0) {
      const adjacency = await this.buildAdjacency();
      const visited = new Map<string, number>();
      const queue: Array<{ path: string; depth: number }> = seedPaths.map((itemPath) => ({ path: itemPath, depth: 0 }));
      for (const seed of seedPaths) visited.set(seed, 0);
      let expanded = 0;
      while (queue.length > 0 && expanded < MAX_GRAPH_EXPAND_NODES) {
        const current = queue.shift()!;
        if (current.depth >= 2) continue;
        for (const neighbor of adjacency.get(current.path) ?? []) {
          if (deadTargets.has(neighbor) || visited.has(neighbor)) continue;
          visited.set(neighbor, current.depth + 1);
          expanded += 1;
          add(neighbor, neighbor, current.depth + 1 === 2 ? 0.4 : 0.7);
          queue.push({ path: neighbor, depth: current.depth + 1 });
        }
      }
    }

    if (scores.size === 0) return [];
    const out = [...scores.entries()].map(([itemPath, score]) => ({
      relativePath: itemPath,
      title: titles.get(itemPath) ?? itemPath,
      score,
    }));
    out.sort((a, b) =>
      a.score === b.score ? a.relativePath.localeCompare(b.relativePath) : b.score - a.score,
    );
    return out.slice(0, MAX_RELATED_SUBSET_ENTRIES);
  }

  private async buildAdjacency(): Promise<Map<string, string[]>> {
    if (!this.db) return new Map();
    const edges = await this.db.listWikiGraphEdges();
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    }
    return adjacency;
  }

  private async deadLinkTargets(): Promise<Set<string>> {
    const out = new Set<string>();
    if (!this.workspace.trim()) return out;
    try {
      const report = await lintWorkspace(this.workspace);
      for (const issue of report.issues) {
        if (issue.code === LINT_CODE_DEAD_LINK) out.add(issue.path);
      }
    } catch {
      // lint failure should not block chat context resolution
    }
    return out;
  }
}

export function formatRelatedSubsetSection(
  docLang: string,
  entries: RelatedSubsetEntry[],
): string {
  if (entries.length === 0) return "";
  const header =
    docLang === "en"
      ? "## Related wiki subset (index only — use read tool for full text)\n\n"
      : "## 相关 wiki 子集（仅索引，全文请用 read 工具）\n\n";
  return header + entries.map((entry) => `- \`${entry.relativePath}\` — ${entry.title || entry.relativePath}\n`).join("");
}

export function injectWikiRefsIntoUserContent(
  docLang: string,
  refs: WikiRefInput[],
  bodies: WikiPageBody[],
  userText: string,
): string {
  const parts: string[] = [];
  bodies.forEach((body, index) => {
    const ref = refs[index];
    const label = ref?.relativePath || ref?.documentId || body.relativePath || body.documentId;
    parts.push(docLang === "en" ? `[Wiki reference: ${label}]\n` : `[Wiki 引用: ${label}]\n`);
    if (body.title) parts.push(`${body.title}\n\n`);
    parts.push(body.content, "\n\n---\n\n");
  });
  parts.push(userText);
  return parts.join("");
}

export async function loadWikiPageBodies(
  db: Store,
  refs: WikiRefInput[],
): Promise<WikiPageBody[]> {
  const out: WikiPageBody[] = [];
  for (const ref of refs) {
    const doc = await db.getWikiDocumentByID(ref.documentId);
    if (!doc) throw new Error(`wiki document not found: ${ref.documentId}`);
    let content = doc.content;
    if (content.length > MAX_WIKI_REF_INJECT_LEN) {
      content = `${content.slice(0, MAX_WIKI_REF_INJECT_LEN)}\n...(truncated)`;
    }
    out.push({
      documentId: doc.id,
      relativePath: doc.relative_path,
      title: doc.title,
      content,
    });
  }
  return out;
}
