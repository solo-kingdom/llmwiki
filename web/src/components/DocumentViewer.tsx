import { useCallback, useEffect, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { useApp } from "@/context/AppContext"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { extractHeadings, slugifyHeading } from "@/lib/markdown"
import type { OutlineItem } from "@/types"
import "highlight.js/styles/github.css"

function headingId(children: ReactNode): string {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === "string" ? c : "")).join("")
        : String(children ?? "")
  return slugifyHeading(text)
}

function makeHeading(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({ children }: { children?: ReactNode }) {
    const id = headingId(children)
    return (
      <Tag id={id} className="scroll-mt-20">
        {children}
      </Tag>
    )
  }
}

const markdownComponents = {
  h1: makeHeading("h1"),
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
  h5: makeHeading("h5"),
  h6: makeHeading("h6"),
}

interface DocumentViewerProps {
  onOutlineChange?: (items: OutlineItem[]) => void
}

export function DocumentViewer({ onOutlineChange }: DocumentViewerProps) {
  const { currentDoc, currentDocId, loading, error, selectDocument } = useApp()

  useEffect(() => {
    if (!onOutlineChange) return
    if (currentDoc?.content) {
      onOutlineChange(extractHeadings(currentDoc.content))
    } else {
      onOutlineChange([])
    }
  }, [currentDoc?.content, onOutlineChange])

  const handleWikilink = useCallback(
    (href: string) => {
      const match = href.match(/^\/d\/(.+)$/)
      if (match) {
        selectDocument(match[1])
        return
      }
    },
    [selectDocument],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!currentDoc) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Select a document to view</p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {currentDoc.title || currentDoc.filename}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{currentDoc.path || "/"}</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{currentDoc.file_type}</span>
            {currentDoc.page_count > 0 && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <span>{currentDoc.page_count} pages</span>
              </>
            )}
            {currentDoc.updated_at && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <span>{new Date(currentDoc.updated_at).toLocaleDateString()}</span>
              </>
            )}
          </div>
          {currentDoc.tags && currentDoc.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {currentDoc.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <article
          className="prose prose-sm max-w-none px-6 py-4 dark:prose-invert"
          onClick={(e) => {
            const target = e.target as HTMLElement
            const anchor = target.closest("a")
            if (anchor) {
              const href = anchor.getAttribute("href")
              if (href?.startsWith("/d/")) {
                e.preventDefault()
                handleWikilink(href)
              }
            }
          }}
        >
          {currentDocId && currentDoc.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {currentDoc.content}
            </ReactMarkdown>
          ) : (
            <p className="text-muted-foreground">
              No content available for this document.
            </p>
          )}
        </article>
      </ScrollArea>
    </div>
  )
}
