import { useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { useApp } from "@/context/AppContext"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SearchBar } from "./SearchBar"
import "highlight.js/styles/github.css"

export function DocumentViewer() {
  const { currentDoc, currentDocId, loading, error, selectDocument } = useApp()

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
      <div className="flex flex-1 flex-col">
        <SearchBar />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Select a document to view</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-w-0">
      <div className="flex items-start justify-between border-b px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {currentDoc.title || currentDoc.filename}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
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
          {currentDoc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {currentDoc.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <SearchBar />
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
