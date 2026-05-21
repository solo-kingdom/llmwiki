import { useCallback, useEffect, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import { extractHeadings, uniqueHeadingSlugSequence } from "@/lib/markdown"
import type { OutlineItem } from "@/types"
import "highlight.js/styles/github.css"

function makeHeadingComponents(slugs: string[]) {
  let index = 0
  const nextSlug = () => slugs[index++] ?? ""
  const makeHeading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function Heading({ children }: { children?: ReactNode }) {
      const id = nextSlug()
      return (
        <Tag id={id} className="scroll-mt-20">
          {children}
        </Tag>
      )
    }
  return {
    h1: makeHeading("h1"),
    h2: makeHeading("h2"),
    h3: makeHeading("h3"),
    h4: makeHeading("h4"),
    h5: makeHeading("h5"),
    h6: makeHeading("h6"),
  }
}

interface DocumentViewerProps {
  onOutlineChange?: (items: OutlineItem[]) => void
  variant?: "classic" | "reader"
}

export function DocumentViewer({
  onOutlineChange,
  variant = "classic",
}: DocumentViewerProps) {
  const t = useT()
  const { currentDoc, currentDocId, loading, error, selectDocument } =
    useWikiReader()
  const isReader = variant === "reader"

  useEffect(() => {
    if (!onOutlineChange) return
    if (currentDoc?.content) {
      onOutlineChange(extractHeadings(currentDoc.content))
    } else {
      onOutlineChange([])
    }
    return () => onOutlineChange([])
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
      <div className={isReader ? "py-8 text-center" : "flex flex-1 items-center justify-center"}>
        <p className="text-muted-foreground">{t("document.loading")}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={isReader ? "py-8 text-center" : "flex flex-1 items-center justify-center"}>
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!currentDoc) {
    return (
      <div className={isReader ? "py-8 text-center" : "flex flex-1 items-center justify-center"}>
        <p className="text-muted-foreground">{t("document.select_hint")}</p>
      </div>
    )
  }

  const article = (
    <article
      className={
        isReader
          ? "wiki-prose max-w-none"
          : "wiki-prose max-w-none px-6 py-4"
      }
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
          components={makeHeadingComponents(
            uniqueHeadingSlugSequence(currentDoc.content),
          )}
        >
          {currentDoc.content}
        </ReactMarkdown>
      ) : (
        <p className="text-muted-foreground">{t("document.no_content")}</p>
      )}
    </article>
  )

  if (isReader) {
    return article
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {article}
    </div>
  )
}
