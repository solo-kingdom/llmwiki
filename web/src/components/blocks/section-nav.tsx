/**
 * SectionNav — secondary navigation inside a page (settings sections, detail sub-pages).
 * Wide container: a vertical list beside the content (its own scroll region). Narrow: a single horizontally
 * scrolling row above it. The nav never scrolls separately from the page.
 */
import * as React from "react"
import { cn } from "cn"
import { AppLink, useAppSearch, useIsActive } from "@/components/blocks/router"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { Body, Split } from "@/components/blocks/surfaces"

export type SectionNavItem = {
  label: string
  to: string
  description?: string | undefined
  /** Leading 16px icon, same as sidebar NavItem. Optional: text-only entries stay valid. */
  icon?: React.ReactNode | undefined
}

function Entry({ item, vertical, keepSearch }: { item: SectionNavItem; vertical: boolean; keepSearch: boolean }) {
  const active = useIsActive(item.to)
  const search = useAppSearch()
  const to = keepSearch && search !== "" && !item.to.includes("?") ? `${item.to}${search}` : item.to
  return (
    <AppLink to={to} aria-current={active ? "page" : undefined}
      className={cn("flex h-[var(--sidebar-row-height,30px)] shrink-0 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-menu-active font-semibold text-menu-active-foreground hover:bg-menu-active hover:text-menu-active-foreground [&_svg]:text-primary" : "text-muted-foreground", vertical && "w-full")}>
      {item.icon}
      {item.label}
    </AppLink>
  )
}

/**
 * SectionLayout — Split with the section nav as side column and a padded Body as content.
 * Put it in `<Page layout="fill">`: nav and content are two scroll regions; the divider runs header rule → frame bottom.
 * `width="narrow"` + `align="center"` is the settings shape: a centered ≤42rem column beside the nav.
 */
export function SectionLayout({ items, label, width = "form", align = "start", children, breakpoint = 720, keepSearch = false }: {
  items: SectionNavItem[]; label: string; width?: "narrow" | "reading" | "form" | "full" | undefined; align?: "start" | "center" | undefined; children: React.ReactNode; breakpoint?: number | undefined
  /** Keep the current query string when switching sections (for example `?lang=en`). */
  keepSearch?: boolean | undefined
}) {
  const [ref, measured] = useContainerWidth<HTMLDivElement>()
  const vertical = measured === 0 || measured >= breakpoint
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Split sideLabel={label} sideWidth="sm" collapseBelow={breakpoint} side={
        <nav aria-label={label} className={cn(vertical ? "flex flex-col gap-0.5" : "-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]")}>
          {items.map((item) => <Entry key={item.to} item={item} vertical={vertical} keepSearch={keepSearch} />)}
        </nav>
      }>
        <Body width={width} align={align}>{children}</Body>
      </Split>
    </div>
  )
}
