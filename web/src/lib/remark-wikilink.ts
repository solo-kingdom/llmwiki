import type { Root, RootContent } from "mdast"
import type { Plugin } from "unified"
import type { DocumentListItem } from "@/types"

/**
 * Matches Obsidian-style wikilinks: [[target]] or [[target|display text]]
 * Same regex as backend's wikiDoubleBracketRe in internal/engine/lint.go
 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g

/** Resolution indexes built from the document list. */
interface ResolutionIndexes {
  docsByWikiPath: Map<string, string>
  slugIndex: Map<string, string>
  titleToId: Map<string, string>
}

/**
 * Slugify a string for normalized matching:
 *  1. Lowercase
 *  2. Spaces → hyphens
 *  3. Collapse consecutive hyphens
 *  4. Trim leading/trailing hyphens
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Resolve a wiki link target to a document ID using a five-strategy
 * approach matching the backend's resolveWikiPath():
 *  1. Exact match in wikiPath index
 *  2. Append .md and retry
 *  3. Match by basename only
 *  4. Slug normalization match
 *  5. Title index match
 */
function resolveWikiPath(
  href: string,
  indexes: ResolutionIndexes,
): string {
  const { docsByWikiPath, slugIndex, titleToId } = indexes
  const lower = href.toLowerCase()

  // Strategy 1: exact match
  const exact = docsByWikiPath.get(lower)
  if (exact) return exact

  // Strategy 2: append .md
  const withMd = docsByWikiPath.get(lower + ".md")
  if (withMd) return withMd

  // Strategy 3: basename match
  let basename = lower
  const slashIdx = basename.lastIndexOf("/")
  if (slashIdx >= 0) basename = basename.slice(slashIdx + 1)

  for (const [path, id] of docsByWikiPath) {
    let pathBase = path
    const idx = pathBase.lastIndexOf("/")
    if (idx >= 0) pathBase = pathBase.slice(idx + 1)
    if (pathBase === basename || pathBase === basename + ".md") {
      return id
    }
  }

  // Strategy 4: slug normalization match
  const slugified = slugify(lower)
  if (slugified) {
    const slugMatch = slugIndex.get(slugified)
    if (slugMatch) return slugMatch

    // Also try slugified + ".md"
    const slugMd = slugIndex.get(slugified + ".md")
    if (slugMd) return slugMd

    // Also try slugified basename
    let slugBase = slugified
    const sIdx = slugBase.lastIndexOf("/")
    if (sIdx >= 0) slugBase = slugBase.slice(sIdx + 1)
    if (slugBase !== slugified) {
      const slugBaseMatch = slugIndex.get(slugBase)
      if (slugBaseMatch) return slugBaseMatch
      const slugBaseMd = slugIndex.get(slugBase + ".md")
      if (slugBaseMd) return slugBaseMd
    }
  }

  // Strategy 5: title index match
  const titleMatch = titleToId.get(lower)
  if (titleMatch) return titleMatch

  return ""
}

/**
 * Build resolution indexes from a document list, matching backend's
 * NewReferenceParser() logic in internal/engine/references.go.
 */
function buildResolutionIndexes(
  documents: DocumentListItem[],
): ResolutionIndexes {
  const docsByWikiPath = new Map<string, string>()
  const slugIndex = new Map<string, string>()
  const titleToId = new Map<string, string>()

  for (const doc of documents) {
    if (doc.path && doc.path.startsWith("/wiki")) {
      let relative = doc.path.startsWith("/wiki/")
        ? doc.path.slice(6) // "/wiki/foo" → "foo"
        : doc.path.slice(5) // "/wiki" → ""
      // Remove leading slash
      if (relative.startsWith("/")) relative = relative.slice(1)
      // Append trailing slash if needed, then filename
      if (relative !== "" && !relative.endsWith("/")) {
        relative += "/"
      }
      relative += doc.filename
      const key = relative.toLowerCase()
      docsByWikiPath.set(key, doc.id)

      // Build slug index (first-write-wins)
      // Add full path slug
      const slug = slugify(key)
      if (slug && !slugIndex.has(slug)) {
        slugIndex.set(slug, doc.id)
      }
      // Add basename slug (with and without extension)
      const lastSlash = key.lastIndexOf("/")
      const basePart = lastSlash >= 0 ? key.slice(lastSlash + 1) : key
      const baseSlug = slugify(basePart)
      if (baseSlug && !slugIndex.has(baseSlug)) {
        slugIndex.set(baseSlug, doc.id)
      }
      // Add basename without extension slug
      const dotIdx = baseSlug.lastIndexOf(".")
      const baseNoExt = dotIdx > 0 ? baseSlug.slice(0, dotIdx) : baseSlug
      if (baseNoExt && baseNoExt !== baseSlug && !slugIndex.has(baseNoExt)) {
        slugIndex.set(baseNoExt, doc.id)
      }
    }

    // Build title index (first-write-wins)
    if (doc.title) {
      const titleKey = doc.title.toLowerCase()
      if (!titleToId.has(titleKey)) {
        titleToId.set(titleKey, doc.id)
      }
    }
  }

  return { docsByWikiPath, slugIndex, titleToId }
}

/**
 * Create a remark plugin that transforms [[wikilink]] syntax into clickable links.
 *
 * Uses a factory pattern so the document list can be injected at call time.
 * Follows the same resolution strategy as the Go backend.
 */
export function createRemarkWikiLink(
  documents: DocumentListItem[],
): Plugin<[], Root> {
  const indexes = buildResolutionIndexes(documents)

  return function remarkWikiLink() {
    return (tree: Root) => {
      visitTextNodes(tree, indexes)
    }
  }
}

/**
 * Recursively visit text nodes in the AST and transform wikilinks.
 * Skips code, inlineCode, and link nodes to avoid false matches.
 */
function visitTextNodes(
  node: Root | RootContent,
  indexes: ResolutionIndexes,
): void {
  if (!("children" in node) || !Array.isArray(node.children)) return

  // Skip code-related nodes (cast to avoid narrow type inference)
  const nodeType = (node as { type: string }).type
  if (
    nodeType === "code" ||
    nodeType === "inlineCode" ||
    nodeType === "link"
  ) {
    return
  }

  const newChildren: RootContent[] = []

  for (const child of node.children as RootContent[]) {
    if (child.type === "text" && "value" in child) {
      const text = child.value as string
      if (!text.includes("[[")) {
        newChildren.push(child)
        continue
      }

      // Split text around [[...]] patterns and create link/html nodes
      const parts = splitByWikilinks(text, indexes)
      newChildren.push(...parts)
    } else {
      // Recurse into children
      visitTextNodes(child, indexes)
      newChildren.push(child)
    }
  }

  // Replace children in-place
  ;(node as { children: RootContent[] }).children = newChildren
}

/**
 * Split a text string by wikilink patterns, producing an array of
 * text, link, and html (broken link) nodes.
 */
function splitByWikilinks(
  text: string,
  indexes: ResolutionIndexes,
): RootContent[] {
  const result: RootContent[] = []
  let lastIndex = 0

  // Reset regex state
  const re = new RegExp(WIKILINK_RE.source, "g")
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push({ type: "text", value: text.slice(lastIndex, match.index) })
    }

    const fullMatch = match[0] // e.g. [[target|display]]
    const target = match[1].trim()
    // Extract display text if present (e.g. [[target|Display Text]] → "Display Text")
    const pipeMatch = fullMatch.match(/^\[\[[^\]|]+\|([^\]]*)\]\]$/)
    const displayText = pipeMatch ? pipeMatch[1] : target

    const resolved = resolveWikiPath(target, indexes)

    if (resolved) {
      // Valid link → create a markdown link node
      result.push({
        type: "link",
        url: `/d/${resolved}`,
        children: [{ type: "text", value: displayText }],
      })
    } else {
      // Broken link → create a link node with wikilink-broken class via hProperties
      result.push({
        type: "link",
        url: "#",
        children: [{ type: "text", value: displayText }],
        data: {
          hProperties: {
            className: "wikilink-broken",
          },
        },
      })
    }

    lastIndex = re.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push({ type: "text", value: text.slice(lastIndex) })
  }

  return result
}


