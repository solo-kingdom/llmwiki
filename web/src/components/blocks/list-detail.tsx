/**
 * ListDetailLayout — master/detail page: a list pane (conversations, inbox, files) beside the routed content.
 * Wide container: the pane is a fixed-width column with its own scroll and a rule against the content.
 * Narrow: the pane is hidden and opens as a Sheet from <ListPaneTrigger /> (put it in PageHeader `leading`);
 * the sheet closes on navigation. RecencyList renders pane items grouped by recency with an active state.
 */
import * as React from "react"
import { useLocation } from "react-router"
import { ListIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { AppLink, useIsActive } from "@/components/blocks/router"
import { useContainerWidth } from "@/components/blocks/use-container-width"

type PaneState = { collapsed: boolean; label: string; open: () => void }
const PaneContext = React.createContext<PaneState | null>(null)

export function ListDetailLayout({ pane, label, children, breakpoint = 900 }: {
  /** Pane content: header (title + create action), search, RecencyList / empty state. */
  pane: React.ReactNode
  /** Accessible name of the pane, e.g. "对话列表". */
  label: string
  children: React.ReactNode
  /** Container width (px) under which the pane becomes a sheet. */
  breakpoint?: number | undefined
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const collapsed = width > 0 && width < breakpoint
  const [sheet, setSheet] = React.useState(false)
  const { pathname } = useLocation()
  React.useEffect(() => setSheet(false), [pathname])
  const state = React.useMemo(() => ({ collapsed, label, open: () => setSheet(true) }), [collapsed, label])
  return (
    <PaneContext.Provider value={state}>
      <div ref={ref} data-surface="split" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !collapsed && "grid grid-cols-[16rem_minmax(0,1fr)]")}>
        {collapsed ? (
          <Sheet open={sheet} onOpenChange={setSheet}>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetTitle className="sr-only">{label}</SheetTitle>
              <div className="flex min-h-0 flex-1 flex-col">{pane}</div>
            </SheetContent>
          </Sheet>
        ) : (
          <aside aria-label={label} data-scroll-region="pane" data-surface="split-side" className="flex min-h-0 flex-col relative overflow-y-auto border-r">
            {pane}
          </aside>
        )}
        <div data-scroll-region="detail" className="flex min-h-0 min-w-0 flex-1 flex-col relative overflow-y-auto">{children}</div>
      </div>
    </PaneContext.Provider>
  )
}

/** Opens the pane sheet; renders nothing while the pane is visible. */
export function ListPaneTrigger() {
  const state = React.useContext(PaneContext)
  if (state === null || !state.collapsed) return null
  return <Button variant="ghost" size="icon-sm" aria-label={state.label} onClick={state.open}><ListIcon /></Button>
}

export type RecencyItem = { id: string; to: string; label: string; time?: string | undefined; menu?: React.ReactNode | undefined }
export type RecencyLabels = { today: string; yesterday: string; week: string; older: string }
const DEFAULT_LABELS: RecencyLabels = { today: "今天", yesterday: "昨天", week: "7 天内", older: "更早" }

function bucket(time: string | undefined, now: Date): keyof RecencyLabels {
  if (time === undefined) return "older"
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = new Date(time).getTime()
  if (t >= start) return "today"
  if (t >= start - 86_400_000) return "yesterday"
  if (t >= start - 6 * 86_400_000) return "week"
  return "older"
}

function Entry({ item }: { item: RecencyItem }) {
  const active = useIsActive(item.to)
  return (
    <li className={cn("group/entry relative flex items-center rounded-md hover:bg-accent", active && "bg-accent")}>
      <AppLink to={item.to} aria-current={active ? "page" : undefined}
        className={cn("min-w-0 flex-1 truncate px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", active ? "font-medium text-accent-foreground" : "text-muted-foreground")}>
        {item.label}
      </AppLink>
      {item.menu !== undefined ? <div className="shrink-0 pr-1 opacity-0 group-hover/entry:opacity-100 group-focus-within/entry:opacity-100 has-[[data-state=open]]:opacity-100">{item.menu}</div> : null}
    </li>
  )
}

/** Items (newest first) grouped into 今天 / 昨天 / 7 天内 / 更早; `time` is an ISO string. */
export function RecencyList({ items, labels = DEFAULT_LABELS, className }: {
  items: RecencyItem[]; labels?: RecencyLabels | undefined; className?: string | undefined
}) {
  const now = new Date()
  const groups = new Map<keyof RecencyLabels, RecencyItem[]>()
  for (const item of items) {
    const key = bucket(item.time, now)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(["today", "yesterday", "week", "older"] as const).map((key) => {
        const list = groups.get(key)
        if (list === undefined) return null
        return (
          <section key={key} aria-label={labels[key]}>
            <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{labels[key]}</h2>
            <ul className="flex flex-col gap-0.5">{list.map((item) => <Entry key={item.id} item={item} />)}</ul>
          </section>
        )
      })}
    </div>
  )
}

/** Pane header row: same 48px height and rule as PageHeader, so the two align across the divider. */
export function PaneHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">{children}</div>
}

/** Pane body block (search, filters, the list). `grow` takes the remaining height. */
export function PaneSection({ grow = false, children }: { grow?: boolean | undefined; children: React.ReactNode }) {
  return <div className={cn("flex min-w-0 flex-col gap-2 p-2", grow && "min-h-0 flex-1")}>{children}</div>
}
