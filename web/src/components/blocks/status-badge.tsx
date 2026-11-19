/** The only way to show a status: word, tone and icon come from vocab, never from the page. */
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { statusEntry, type Tone } from "@/lib/vocab"

// Text stays foreground for AA contrast at 12px; the tone lives in the dot and a faint tint.
const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-foreground",
  success: "bg-success/10 text-foreground",
  warning: "bg-warning/15 text-foreground",
  danger: "bg-destructive/10 text-foreground",
}
const dotClass: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60", info: "bg-info", success: "bg-success", warning: "bg-warning", danger: "bg-destructive",
}

export function StatusBadge({ status, className }: { status: string; className?: string | undefined }) {
  const entry = statusEntry(status)
  return (
    <Badge variant="secondary" data-status={status} className={cn("gap-1.5 font-normal", toneClass[entry.tone], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dotClass[entry.tone], entry.pulse && "animate-pulse motion-reduce:animate-none")} />
      {entry.label}
    </Badge>
  )
}
