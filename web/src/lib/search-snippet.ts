export interface HighlightSegment {
  text: string
  match: boolean
}

/** Strip YAML frontmatter block if present at the top of markdown content. */
export function stripFrontmatterText(raw: string): string {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  return match ? raw.slice(match[0].length) : raw
}

/** Clean markdown syntax into readable plain text for search result snippets. */
export function cleanMarkdownForSnippet(raw: string): string {
  return stripFrontmatterText(raw)
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, " "))
    .replace(/\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => (label ?? target).trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*~]+/g, "")
    .replace(/(^|\s)_+|_+(\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

/** Build a centered snippet around the first query match, or the leading summary. */
export function buildContentSnippet(raw: string, query: string, maxLen = 180): string {
  const cleaned = cleanMarkdownForSnippet(raw)
  if (!cleaned) return ""
  const q = query.trim()
  if (!q) {
    return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen).trimEnd()}…`
  }

  const lower = cleaned.toLowerCase()
  const lowerQ = q.toLowerCase()
  let idx = lower.indexOf(lowerQ)
  if (idx < 0) {
    for (const term of lowerQ.split(/\s+/).filter(Boolean)) {
      const found = lower.indexOf(term)
      if (found >= 0 && (idx < 0 || found < idx)) idx = found
    }
  }
  if (idx < 0) {
    return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen).trimEnd()}…`
  }

  const before = Math.min(56, Math.floor(maxLen / 3))
  let start = Math.max(0, idx - before)
  if (start > 0) {
    const space = cleaned.indexOf(" ", start)
    if (space > start && space < idx && idx - space <= before) {
      start = space + 1
    }
  }
  const end = Math.min(cleaned.length, start + maxLen)
  const slice = cleaned.slice(start, end).trim()
  return `${start > 0 ? "…" : ""}${slice}${end < cleaned.length ? "…" : ""}`
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Split text into matched/unmatched segments for safe React highlighting. */
export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  const trimmed = query.trim()
  if (!text || !trimmed) return text ? [{ text, match: false }] : []

  const terms = [...new Set([trimmed, ...trimmed.split(/\s+/).filter((t) => t.length > 0)])]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (terms.length === 0) return [{ text, match: false }]

  const regex = new RegExp(`(${terms.join("|")})`, "gi")
  const parts = text.split(regex)
  const lowerTerms = new Set(
    [trimmed, ...trimmed.split(/\s+/).filter((t) => t.length > 0)].map((t) => t.toLowerCase()),
  )
  const out: HighlightSegment[] = []
  for (const part of parts) {
    if (!part) continue
    out.push({ text: part, match: lowerTerms.has(part.toLowerCase()) })
  }
  return out
}
