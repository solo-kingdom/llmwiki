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
    <div className={cn("flex-1 overflow-auto", className)}>
      <div className="py-6">{children}</div>
    </div>
  )
}
