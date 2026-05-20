import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="px-1 py-6">{children}</div>
    </div>
  )
}
