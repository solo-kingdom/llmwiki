import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function AppHeaderBar({
  left,
  right,
  className,
}: {
  left: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "relative z-40 flex h-12 shrink-0 items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">{left}</div>
      {right != null && (
        <div className="flex items-center gap-2">{right}</div>
      )}
    </header>
  )
}
