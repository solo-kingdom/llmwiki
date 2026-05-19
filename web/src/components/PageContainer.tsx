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
      <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
    </div>
  )
}
