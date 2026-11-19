/** CodeBlock — monospace, horizontal scroll, language label, copy. No syntax highlighting by design (bundle cost). */
import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "cn"
import { vocab } from "@/lib/vocab"

export function CodeBlock({ code, language, className, maxHeight = "24rem" }: { code: string; language?: string | undefined; className?: string | undefined; maxHeight?: string | undefined }) {
  const [copied, setCopied] = React.useState(false)
  const onCopy = () => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }) }
  return (
    <div className={cn("group/code relative my-2 overflow-hidden rounded-lg border bg-muted/40", className)}>
      <div className="flex h-8 items-center justify-between border-b px-3 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? "text"}</span>
        <button type="button" onClick={onCopy} aria-label={copied ? vocab.copy.copied : vocab.copy.copy}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <pre className="overflow-auto p-3 font-mono text-xs leading-5" style={{ maxHeight }}><code>{code}</code></pre>
    </div>
  )
}
