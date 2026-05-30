import { useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/lib/utils"
import { createRemarkWikiLink } from "@/lib/remark-wikilink"
import type { PluggableList } from "unified"
import type { DocumentListItem } from "@/types"
import "highlight.js/styles/github.css"

export type MarkdownContentVariant = "chat" | "reader"

export interface MarkdownContentProps {
  content: string
  variant?: MarkdownContentVariant
  className?: string
  components?: Components
  /** Optional document list to enable [[wikilink]] rendering */
  documents?: DocumentListItem[]
}

const defaultTableComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="markdown-table-wrap overflow-x-auto">
      <table {...props}>{children}</table>
    </div>
  ),
}

export function MarkdownContent({
  content,
  variant = "reader",
  className,
  components,
  documents,
}: MarkdownContentProps) {
  const proseClass = variant === "chat" ? "chat-prose" : "wiki-prose"

  const remarkPlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [remarkGfm]
    if (documents && documents.length > 0) {
      plugins.push(createRemarkWikiLink(documents))
    }
    return plugins
  }, [documents])

  return (
    <div
      className={cn(proseClass, "max-w-none", className)}
      onClick={(e) => {
        const target = e.target as HTMLElement
        const anchor = target.closest("a")
        if (anchor) {
          const href = anchor.getAttribute("href")
          if (href === "#" || anchor.classList.contains("wikilink-broken")) {
            e.preventDefault()
          }
        }
      }}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeHighlight]}
        components={{ ...defaultTableComponents, ...components }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
