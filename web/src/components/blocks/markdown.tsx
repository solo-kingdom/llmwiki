/** Markdown — assistant/user content rendering (GFM: tables, lists, task lists, links). Raw HTML is not rendered.
 * Content tables and code blocks share the panel radius (rounded-lg + border); the root carries data-prose so
 * check_rendered treats its tables as content, not data tables. */
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "cn"
import { CodeBlock } from "@/components/blocks/code-block"

/** react-markdown passes the hast `node`; it must not reach the DOM. */
function withoutNode<P extends { node?: unknown }>(props: P): Omit<P, "node"> {
  const rest: Partial<P> = { ...props }
  delete rest.node
  return rest as Omit<P, "node">
}

const components: Components = {
  a: (props) => <a {...withoutNode(props)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2" />,
  code: (raw) => {
    const { className, children, ...props } = withoutNode(raw)
    const language = /language-(\S+)/.exec(className ?? "")?.[1]
    const text = String(children ?? "").replace(/\n$/, "")
    const block = language !== undefined || text.includes("\n")
    return block ? <CodeBlock code={text} {...(language !== undefined ? { language } : {})} /> : <code {...props} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  },
  pre: ({ children }) => <>{children}</>,
  table: (props) => <div className="my-2 overflow-x-auto rounded-lg border"><table {...withoutNode(props)} className="w-full border-collapse text-sm [&_tbody_tr]:border-t [&_td]:px-2 [&_td]:py-1 [&_td+td]:border-l [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th+th]:border-l" /></div>,
}

export function Markdown({ children, className }: { children: string; className?: string | undefined }) {
  return (
    <div data-prose className={cn("min-w-0 text-sm leading-6 break-words [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-medium [&_hr]:my-4 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  )
}
