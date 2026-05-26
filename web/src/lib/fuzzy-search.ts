import Fuse from "fuse.js"
import type { DocumentListItem } from "@/types"

let fuseInstance: Fuse<DocumentListItem> | null = null
let lastDocsRef: DocumentListItem[] | null = null

function getFuse(docs: DocumentListItem[]): Fuse<DocumentListItem> {
  if (fuseInstance && lastDocsRef === docs) return fuseInstance
  fuseInstance = new Fuse(docs, {
    keys: ["title", "path"],
    threshold: 0.4,
    includeScore: true,
  })
  lastDocsRef = docs
  return fuseInstance
}

export function fuzzySearchDocs(
  docs: DocumentListItem[],
  query: string,
  limit = 10,
): DocumentListItem[] {
  if (!query.trim()) return docs.slice(0, limit)
  const fuse = getFuse(docs)
  return fuse.search(query, { limit }).map((r) => r.item)
}
