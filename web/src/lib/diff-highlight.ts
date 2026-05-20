import hljs from "highlight.js/lib/core"
import markdown from "highlight.js/lib/languages/markdown"
import json from "highlight.js/lib/languages/json"
import typescript from "highlight.js/lib/languages/typescript"
import javascript from "highlight.js/lib/languages/javascript"
import go from "highlight.js/lib/languages/go"
import python from "highlight.js/lib/languages/python"
import yaml from "highlight.js/lib/languages/yaml"
import xml from "highlight.js/lib/languages/xml"
import css from "highlight.js/lib/languages/css"
import bash from "highlight.js/lib/languages/bash"
import sql from "highlight.js/lib/languages/sql"
import type { HunkData } from "react-diff-view"
import { tokenize, type HunkTokens } from "react-diff-view"

hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("json", json)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("go", go)
hljs.registerLanguage("python", python)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("css", css)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sql", sql)

const EXT_TO_LANGUAGE: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  go: "go",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  html: "xml",
  htm: "xml",
  xml: "xml",
  css: "css",
  sh: "bash",
  bash: "bash",
  sql: "sql",
}

export interface HljsToken {
  type: string
  value?: string
  className?: string
  children?: HljsToken[]
}

/** Map file path extension to a highlight.js language id. */
export function inferLanguage(path: string): string {
  const base = path.split("/").pop() ?? path
  const dot = base.lastIndexOf(".")
  if (dot < 0) return ""
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_TO_LANGUAGE[ext] ?? ext
}

/** Whether highlight.js has a grammar registered for this language. */
export function canHighlightLanguage(language: string): boolean {
  return language !== "" && hljs.getLanguage(language) !== undefined
}

function htmlToTokens(html: string): HljsToken[] {
  if (!html) return [{ type: "text", value: "" }]

  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  )
  const root = doc.body.firstElementChild
  if (!root) return [{ type: "text", value: html }]

  const walk = (node: Node): HljsToken[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ""
      return value ? [{ type: "text", value }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []

    const el = node as Element
    if (el.tagName === "span" && el.getAttribute("class")) {
      const className = el.getAttribute("class") ?? undefined
      const children = Array.from(el.childNodes).flatMap(walk)
      if (children.length === 1 && children[0].type === "text") {
        return [{ type: "hljs", className, value: children[0].value }]
      }
      return [{ type: "hljs", className, children }]
    }
    return Array.from(el.childNodes).flatMap(walk)
  }

  return walk(root)
}

/** highlight.js adapter matching react-diff-view's refractor interface. */
export const hljsRefractor = {
  highlight(text: string, language: string): HljsToken[] {
    if (!text) return [{ type: "text", value: "" }]
    try {
      const result = hljs.highlight(text, { language, ignoreIllegals: true })
      return htmlToTokens(result.value)
    } catch {
      return [{ type: "text", value: text }]
    }
  },
}

/** Tokenize hunks with syntax highlighting when a registered language is available. */
export function tokenizeHunks(
  hunks: HunkData[],
  language: string,
): HunkTokens | undefined {
  if (!canHighlightLanguage(language)) {
    return undefined
  }
  try {
    return tokenize(hunks, {
      highlight: true,
      refractor: hljsRefractor,
      language,
    })
  } catch {
    return undefined
  }
}
