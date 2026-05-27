import type { Root, RootContent } from "mdast"
import type { Plugin } from "unified"
import type { DocumentListItem } from "@/types"

/**
 * Matches Obsidian-style wikilinks: [[target]] or [[target|display text]]
 * Same regex as backend's wikiDoubleBracketRe in internal/engine/lint.go
 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g

/**
 * Strips file extension from a filename, matching backend's stripExtension().
 */
function stripExtension(name: string): string {
  const exts = [
    ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
    ".csv", ".html", ".htm", ".md", ".txt",
  ]
  for (const ext of exts) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  const idx = name.lastIndexOf(".")
  if (idx > 0) return name.slice(0, idx)
  return name
}

/**
 * Resolve a wiki link target to a document ID using the same three-strategy
 * approach as the backend's resolveWikiPath() in internal/engine/references.go:
 *  1. Exact match in wikiPath index
 *  2. Append .md and retry
 *  3. Match by basename only
 */
function resolveWikiPath(
  href: string,
  docsByWikiPath: Map<string, string>,
): string {
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

  return ""
}

/**
 * Build a wikiPath index from a document list, matching backend's
 * NewReferenceParser() logic in internal/engine/references.go.
 */
function buildWikiPathIndex(
  documents: DocumentListItem[],
): Map<string, string> {
  const index = new Map<string, string>()
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
      index.set(relative.toLowerCase(), doc.id)
    }
  }
  return index
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
  const docsByWikiPath = buildWikiPathIndex(documents)

  return function remarkWikiLink() {
    return (tree: Root) => {
      visitTextNodes(tree, docsByWikiPath)
    }
  }
}

/**
 * Recursively visit text nodes in the AST and transform wikilinks.
 * Skips code, inlineCode, and link nodes to avoid false matches.
 */
function visitTextNodes(
  node: Root | RootContent,
  docsByWikiPath: Map<string, string>,
): void {
  if (!("children" in node) || !Array.isArray(node.children)) return

  // Skip code-related nodes
  if (
    node.type === "code" ||
    node.type === "inlineCode" ||
    node.type === "link"
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
      const parts = splitByWikilinks(text, docsByWikiPath)
      newChildren.push(...parts)
    } else {
      // Recurse into children
      visitTextNodes(child, docsByWikiPath)
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
  docsByWikiPath: Map<string, string>,
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

    const resolved = resolveWikiPath(target, docsByWikiPath)

    if (resolved) {
      // Valid link → create a markdown link node
      result.push({
        type: "link",
        url: `/d/${resolved}`,
        children: [{ type: "text", value: displayText }],
      })
    } else {
      // Broken link → create an html node with wikilink-broken class
      result.push({
        type: "html",
        value: `<span class="wikilink-broken">${escapeHtml(displayText)}</span>`,
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
