/**
 * Conversation surfaces — transcript geometry for the conversation pattern (document layout).
 * Pages compose these; spacing, rules and the composer dock are owned here.
 */
import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "cn"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

/** Ordered transcript; the only live region of the page. */
export function Transcript({ label, children }: { label: string; children: React.ReactNode }) {
  return <ol role="log" aria-live="polite" aria-label={label} className="flex min-w-0 flex-col gap-8">{children}</ol>
}

/** One exchange (user message + agent run); children stack with a fixed rhythm. */
export function Turn({ children }: { children: React.ReactNode }) {
  return <li className="flex min-w-0 flex-col gap-4">{children}</li>
}

/** A message inside a turn: meta line (role, time, badges) above the body; `footer` for actions. */
export function Message({ meta, children, footer }: { meta?: React.ReactNode | undefined; children: React.ReactNode; footer?: React.ReactNode | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {meta !== undefined ? <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div> : null}
      <div className="flex min-w-0 flex-col gap-2 text-sm">{children}</div>
      {footer !== undefined ? <div className="-ml-2 flex flex-wrap items-center gap-1">{footer}</div> : null}
    </div>
  )
}

/** Collapsible one-line summary of intermediate steps (tool calls, sub-tasks); open while running. */
export function Steps({ summary, defaultOpen = false, children }: { summary: React.ReactNode; defaultOpen?: boolean | undefined; children?: React.ReactNode | undefined }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {summary}
      </CollapsibleTrigger>
      {children !== undefined ? <CollapsibleContent><StepList>{children}</StepList></CollapsibleContent> : null}
    </Collapsible>
  )
}

/** Attachment / artifact chip: icon, name (truncates), muted meta. */
export function AttachmentChip({ icon, name, meta }: { icon: React.ReactNode; name: string; meta?: React.ReactNode | undefined }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}<span className="truncate">{name}</span>{meta !== undefined ? <span className="shrink-0 text-muted-foreground">{meta}</span> : null}
    </span>
  )
}

/** Blinking caret appended to streaming text. */
export function StreamingCursor() {
  return <span aria-hidden="true" className="inline-block h-4 w-1.5 animate-pulse bg-muted-foreground align-middle" />
}

/** Indented step list (tool calls, sub-tasks) under a collapsible summary. */
export function StepList({ children }: { children: React.ReactNode }) {
  return <ul className="mt-2 ml-1.5 flex min-w-0 flex-col gap-1.5 border-l pl-4 text-xs">{children}</ul>
}
export function Step({ children }: { children: React.ReactNode }) {
  return <li className="flex min-w-0 flex-wrap items-center gap-2">{children}</li>
}

/** Quoted source text (e.g. the message a task is created from); scrolls past 12rem. */
export function Quote({ children }: { children: React.ReactNode }) {
  return <blockquote data-scroll-ok className="max-h-48 overflow-y-auto rounded-md border-l-2 bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap text-muted-foreground">{children}</blockquote>
}

/** Placeholder line inside the transcript when it is empty. */
export function TranscriptEmpty({ children }: { children: React.ReactNode }) {
  return <li className="py-12 text-center text-sm text-muted-foreground">{children}</li>
}

/** Composer dock: last child of a `fill` Page, below the transcript ScrollRegion; same width as the transcript. */
export function ComposerDock({ width = "reading", children }: { width?: "reading" | "form" | undefined; children: React.ReactNode }) {
  return (
    <div className="shrink-0 bg-background px-4 pt-2 pb-4">
      <div className={cn("mx-auto w-full", width === "reading" ? "max-w-3xl" : "max-w-4xl")}>{children}</div>
    </div>
  )
}
