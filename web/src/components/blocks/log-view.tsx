/**
 * LogView — virtualized log/event stream: follow tail, wrap toggle, text filter, level colors.
 * Stays fast at 10k+ lines; structured payloads collapse by default.
 */
import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDownToLineIcon, WrapTextIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDateTime } from "@/components/blocks/format"

export type LogLine = { id: string; time?: string | number | undefined; level?: "debug" | "info" | "warn" | "error" | undefined; text: string; detail?: unknown | undefined }

const levelClass = { debug: "text-muted-foreground", info: "text-foreground", warn: "text-warning-foreground", error: "text-destructive" } as const

export function LogView({ lines, height = "28rem", follow: followDefault = true, filterPlaceholder = "过滤", className }: {
  lines: LogLine[]; height?: string | undefined; follow?: boolean | undefined; filterPlaceholder?: string | undefined; className?: string | undefined
}) {
  const [filter, setFilter] = React.useState("")
  const [wrap, setWrap] = React.useState(false)
  const [follow, setFollow] = React.useState(followDefault)
  const [open, setOpen] = React.useState<Set<string>>(() => new Set())
  const parent = React.useRef<HTMLDivElement | null>(null)
  const visible = React.useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle === "" ? lines : lines.filter((line) => line.text.toLowerCase().includes(needle))
  }, [lines, filter])
  const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => parent.current, estimateSize: () => 20, overscan: 20 })
  React.useEffect(() => { if (follow && visible.length > 0) virtualizer.scrollToIndex(visible.length - 1, { align: "end" }) }, [follow, visible.length, virtualizer])
  const onScroll = () => {
    const el = parent.current
    if (el !== null) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return (
    <div data-surface="panel" className={cn("flex min-w-0 flex-col overflow-clip rounded-lg border", className)}>
      <div className="flex items-center gap-2 border-b p-2">
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={filterPlaceholder} aria-label={filterPlaceholder} className="h-7 max-w-64" />
        <span className="flex-1 text-xs text-muted-foreground tabular-nums">{visible.length} / {lines.length}</span>
        <Button variant={wrap ? "secondary" : "ghost"} size="icon-sm" aria-pressed={wrap} aria-label="wrap" onClick={() => setWrap(!wrap)}><WrapTextIcon /></Button>
        <Button variant={follow ? "secondary" : "ghost"} size="icon-sm" aria-pressed={follow} aria-label="follow" onClick={() => setFollow(!follow)}><ArrowDownToLineIcon /></Button>
      </div>
      <div ref={parent} onScroll={onScroll} role="log" aria-live={follow ? "polite" : "off"} className="overflow-auto bg-muted/20 font-mono text-xs" style={{ height }}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = visible[item.index]
            if (line === undefined) return null
            const expanded = open.has(line.id)
            return (
              <div key={line.id} ref={virtualizer.measureElement} data-index={item.index} className="absolute inset-x-0 px-3 py-0.5 hover:bg-muted/50" style={{ transform: `translateY(${item.start}px)` }}>
                <div className={cn("flex gap-3", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
                  {line.time !== undefined ? <span className="shrink-0 text-muted-foreground tabular-nums">{formatDateTime(line.time, { timeStyle: "medium" })}</span> : null}
                  <span className={cn("min-w-0", levelClass[line.level ?? "info"])}>{line.text}</span>
                  {line.detail !== undefined ? <button type="button" onClick={() => toggle(line.id)} className="shrink-0 text-muted-foreground underline-offset-2 hover:underline">{expanded ? "−" : "{…}"}</button> : null}
                </div>
                {expanded ? <pre className="mt-1 mb-1 overflow-x-auto rounded bg-muted/50 p-2 whitespace-pre">{JSON.stringify(line.detail, null, 2)}</pre> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
