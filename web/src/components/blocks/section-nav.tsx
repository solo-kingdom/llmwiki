/**
 * SectionNav — secondary navigation inside a page (settings sections, detail sub-pages).
 * Wide container: a vertical list beside the content (its own scroll region). Narrow: a single horizontally
 * scrolling row above it. The nav never scrolls separately from the page.
 */
import * as React from "react"
import { cn } from "cn"
import { AppLink, useIsActive } from "@/components/blocks/router"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { Body, Split } from "@/components/blocks/surfaces"

export type SectionNavItem = { label: string; to: string; description?: string | undefined }

function Entry({ item, vertical }: { item: SectionNavItem; vertical: boolean }) {
  const active = useIsActive(item.to)
  return (
    <AppLink to={item.to} aria-current={active ? "page" : undefined}
      className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground", vertical && "w-full")}>
      {item.label}
    </AppLink>
  )
}

/**
 * SectionLayout — Split with the section nav as side column and a padded Body as content.
 * Put it in `<Page layout="fill">`: nav and content are two scroll regions; the divider runs header rule → frame bottom.
 */
export function SectionLayout({ items, label, width = "form", children, breakpoint = 720 }: {
  items: SectionNavItem[]; label: string; width?: "reading" | "form" | "full" | undefined; children: React.ReactNode; breakpoint?: number | undefined
}) {
  const [ref, measured] = useContainerWidth<HTMLDivElement>()
  const vertical = measured === 0 || measured >= breakpoint
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Split sideLabel={label} sideWidth="sm" collapseBelow={breakpoint} side={
        <nav aria-label={label} className={cn(vertical ? "flex flex-col gap-0.5" : "-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]")}>
          {items.map((item) => <Entry key={item.to} item={item} vertical={vertical} />)}
        </nav>
      }>
        <Body width={width} align="start">{children}</Body>
      </Split>
    </div>
  )
}
