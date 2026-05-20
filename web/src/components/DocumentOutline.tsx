import { ScrollArea } from "@/components/ui/scroll-area"
import type { OutlineItem } from "@/types"
import { cn } from "@/lib/utils"

interface DocumentOutlineProps {
  items: OutlineItem[]
  className?: string
  variant?: "classic" | "reader"
}

export function DocumentOutline({
  items,
  className,
  variant = "classic",
}: DocumentOutlineProps) {
  const isReader = variant === "reader"
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full flex-col",
          isReader ? "" : "bg-card",
          className,
        )}
      >
        <div className="border-b px-3 py-2 text-sm font-medium text-muted-foreground">
          大纲
        </div>
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          当前文档无标题
        </p>
      </div>
    )
  }

  const handleClick = (slug: string) => {
    const el = document.getElementById(slug)
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        isReader ? "" : "border-l bg-card",
        className,
      )}
    >
      <div className="shrink-0 border-b px-3 py-2 text-sm font-medium text-muted-foreground">
        大纲
      </div>
      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2">
          {items.map((item) => (
            <button
              key={`${item.slug}-${item.text}`}
              type="button"
              onClick={() => handleClick(item.slug)}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                item.level >= 3 && "text-xs",
              )}
              style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
            >
              <span className="line-clamp-2">{item.text}</span>
            </button>
          ))}
        </nav>
      </ScrollArea>
    </div>
  )
}
