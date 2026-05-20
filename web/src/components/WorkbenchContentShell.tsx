import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export const WORKBENCH_CONTENT_CLASS =
  "mx-auto flex w-full min-h-0 max-w-5xl flex-1 flex-col px-6"

export function WorkbenchContentShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(WORKBENCH_CONTENT_CLASS, className)}>{children}</div>
  )
}
