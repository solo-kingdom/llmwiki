/** Wiki summary page types (matches backend engine.WikiPageType). */
export const WIKI_PAGE_TYPES = [
  "entity",
  "concept",
  "source",
  "synthesis",
  "comparison",
  "query",
] as const

export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number]

export function inferPageType(doc: {
  page_type?: string
  relative_path?: string
  path?: string
}): WikiPageType | "page" {
  if (doc.page_type && WIKI_PAGE_TYPES.includes(doc.page_type as WikiPageType)) {
    return doc.page_type as WikiPageType
  }
  const rel =
    doc.relative_path ||
    (doc.path ? doc.path.replace(/^\//, "") : "")
  const parts = rel.split("/").filter(Boolean)
  if (parts.length >= 2) {
    const sub = parts[1]
    const map: Record<string, WikiPageType> = {
      entities: "entity",
      concepts: "concept",
      sources: "source",
      synthesis: "synthesis",
      comparisons: "comparison",
      queries: "query",
    }
    if (map[sub]) return map[sub]
  }
  return "page"
}

export function filterByPageTypes<T extends { page_type?: string; relative_path?: string; path?: string }>(
  docs: T[],
  selected: string[],
): T[] {
  if (selected.length === 0) return docs
  const set = new Set(selected)
  return docs.filter((d) => set.has(inferPageType(d)))
}
