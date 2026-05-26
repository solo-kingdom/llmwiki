import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/lib/utils"
import "highlight.js/styles/github.css"

export type MarkdownContentVariant = "chat" | "reader"

export interface MarkdownContentProps {
  content: string
  variant?: MarkdownContentVariant
  className?: string
  components?: Components
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
}: MarkdownContentProps) {
  const proseClass = variant === "chat" ? "chat-prose" : "wiki-prose"

  return (
    <div className={cn(proseClass, "max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ ...defaultTableComponents, ...components }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
