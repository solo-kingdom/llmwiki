/**
 * Surfaces — the layout layer. Surfaces own every border, radius, padding, gap and divider; pages compose
 * them and never write those classes (lint: ui-template/no-layout-classes).
 *
 * Geometry contract (two radius levels, seams owned by containers):
 *   frame  — the AppShell canvas: radius-xl, fixed to the viewport (border, margin and radius always visible).
 *   scroll — html/body and the frame never scroll. The only scrollers are ScrollRegions declared by surfaces:
 *            Page (padded) = header + one main region; Split / SectionLayout = side + main; ListDetailLayout =
 *            pane + detail. Pages never add their own scroll containers. Regions are `relative` so absolutely
 *            positioned descendants (Radix hidden form inputs, popper anchors) overflow the region, not the frame.
 *   panel  — bordered region inside a page (Panel, DataTable frame, LogView): radius-lg. Nothing else is rounded
 *            except controls (shadcn). Flush children of a panel have no radius and no border of their own.
 *   seams  — a split draws its divider on the container edge, so it always runs from the header rule to the
 *            frame bottom. Siblings never draw borders toward each other.
 */
import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "cn"
import { PageHeader, type HeaderAction } from "@/components/blocks/page-header"
import { useContainerWidth } from "@/components/blocks/use-container-width"

type Width = "reading" | "form" | "full"
const maxWidth: Record<Width, string> = { reading: "max-w-3xl", form: "max-w-4xl", full: "" }
const gapClass = { xs: "gap-1", sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-8" } as const
export type Gap = keyof typeof gapClass

/** Padded, width-limited content column. Used by Page (padded) and inside Split / SectionLayout content. */
export function Body({ width = "full", gap = "lg", align = "center", children }: { width?: Width | undefined; gap?: Gap | undefined; align?: "center" | "start" | undefined; children: React.ReactNode }) {
  return <div data-surface="body" className={cn("@container/page flex w-full min-w-0 flex-1 flex-col p-4 @3xl/page:p-6", align === "center" && "mx-auto", gapClass[gap], maxWidth[width])}>{children}</div>
}

/**
 * Page — fixed header + content. `padded` (default): one main ScrollRegion around a Body. `fill`: the content is a
 * full-bleed surface that declares its own regions (Split, SectionLayout, ListDetailLayout) or a conversation
 * (ScrollRegion + ComposerDock).
 */
export function Page({ title, breadcrumbs, primary, actions, leading, width = "full", gap = "lg", layout = "padded", children }: {
  title: string
  breadcrumbs?: { label: string; to: string }[] | undefined
  primary?: React.ReactNode | undefined
  actions?: HeaderAction[] | undefined
  leading?: React.ReactNode | undefined
  width?: Width | undefined
  gap?: Gap | undefined
  layout?: "padded" | "fill" | undefined
  children: React.ReactNode
}) {
  return (
    <div data-surface="page" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={title} breadcrumbs={breadcrumbs} primary={primary} actions={actions} leading={leading} />
      {layout === "padded"
        ? <ScrollRegion><Body width={width} gap={gap}>{children}</Body></ScrollRegion>
        : <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>}
    </div>
  )
}

/**
 * ScrollRegion — a declared scroller (the only kind there is). `follow` keeps the view pinned to the bottom while
 * content grows (streaming) unless the user scrolled up.
 */
export function ScrollRegion({ name = "main", label, follow = false, children }: {
  name?: string | undefined; label?: string | undefined; follow?: boolean | undefined; children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)
  React.useEffect(() => {
    const el = ref.current
    if (!follow || el === null) return
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const toBottom = () => { if (pinned.current) el.scrollTop = el.scrollHeight }
    toBottom()
    const observer = new ResizeObserver(toBottom)
    for (const child of Array.from(el.children)) observer.observe(child)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener("scroll", onScroll) }
  }, [follow])
  return (
    <div ref={ref} data-scroll-region={name} {...(label !== undefined ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
      className="flex min-h-0 min-w-0 flex-1 flex-col relative overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
      {children}
    </div>
  )
}

/**
 * Split — side column + main column, each its own scroll region, divider drawn by the container (full height,
 * meets the header rule above and the frame edge below). Below `collapseBelow` px it stacks: side on top, main scrolls.
 */
export function Split({ side, sideLabel, sideWidth = "md", collapseBelow = 720, children }: {
  side: React.ReactNode; sideLabel: string; sideWidth?: "sm" | "md" | "lg" | undefined
  collapseBelow?: number | undefined; children: React.ReactNode
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const stacked = width > 0 && width < collapseBelow
  const cols = { sm: "grid-cols-[12rem_minmax(0,1fr)]", md: "grid-cols-[14rem_minmax(0,1fr)]", lg: "grid-cols-[18rem_minmax(0,1fr)]" }[sideWidth]
  return (
    <div ref={ref} data-surface="split" className={cn("flex min-h-0 min-w-0 flex-1", stacked ? "flex-col divide-y" : cn("grid divide-x", cols))}>
      <div data-surface="split-side" data-scroll-region="side" aria-label={sideLabel} role="region" className={cn("min-w-0 relative overflow-y-auto", stacked ? "max-h-[40%] shrink-0" : "min-h-0")}>
        <div className="p-3">{side}</div>
      </div>
      <div data-surface="split-main" data-scroll-region="main" className="flex min-h-0 min-w-0 flex-1 flex-col relative overflow-y-auto">{children}</div>
    </div>
  )
}

/** Panel — a bordered region (radius-lg). Header row (title / description / actions) is separated by a rule. */
export function Panel({ title, description, actions, padding = "md", tone = "card", children }: {
  title?: React.ReactNode | undefined; description?: React.ReactNode | undefined; actions?: React.ReactNode | undefined
  /** "none" for flush content (tables, lists, logs) that runs to the panel edges. */
  padding?: "none" | "md" | undefined
  tone?: "card" | "muted" | undefined
  children: React.ReactNode
}) {
  const head = title !== undefined || description !== undefined || actions !== undefined
  return (
    <section data-surface="panel" className={cn("min-w-0 overflow-clip rounded-lg border", tone === "card" ? "bg-card" : "bg-muted/40")}>
      {head ? (
        <div className="flex min-w-0 items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {title !== undefined ? <h2 className="truncate text-sm font-medium">{title}</h2> : null}
            {description !== undefined ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("min-w-0", padding === "md" && "p-4")}>{children}</div>
    </section>
  )
}

/** Section — unbordered group with a heading; vertical rhythm comes from the parent Body/Stack gap. */
export function Section({ title, description, actions, gap = "md", size = "md", children }: {
  title: React.ReactNode; description?: React.ReactNode | undefined; actions?: React.ReactNode | undefined
  gap?: Gap | undefined
  /** "lg" for the top section of a page/settings tab. */
  size?: "md" | "lg" | undefined
  children: React.ReactNode
}) {
  return (
    <section data-surface="section" className={cn("flex min-w-0 flex-col", gapClass[gap])}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={size === "lg" ? "text-base font-semibold" : "text-sm font-semibold"}>{title}</h2>
          {description !== undefined ? <p className={cn("text-muted-foreground", size === "lg" ? "mt-1 text-sm" : "mt-0.5 text-xs")}>{description}</p> : null}
        </div>
        {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Stack — vertical (default) or horizontal group with a gap from the scale. The only way pages space things. */
export function Stack({ gap = "md", direction = "column", align, justify, wrap = false, grow = false, children }: {
  gap?: Gap | undefined; direction?: "column" | "row" | undefined; align?: "start" | "center" | "end" | "baseline" | undefined
  justify?: "start" | "between" | "end" | "center" | undefined; wrap?: boolean | undefined; grow?: boolean | undefined; children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0", direction === "column" ? "flex-col" : "flex-row", gapClass[gap], wrap && "flex-wrap", grow && "flex-1",
      align === "start" && "items-start", align === "center" && "items-center", align === "end" && "items-end", align === "baseline" && "items-baseline",
      justify === "between" && "justify-between", justify === "end" && "justify-end", justify === "center" && "justify-center")}>
      {children}
    </div>
  )
}

/** Toolbar — the row above a collection: filters left, actions right (`end`). Wraps on narrow containers. */
export function Toolbar({ children, end }: { children: React.ReactNode; end?: React.ReactNode | undefined }) {
  return (
    <div data-surface="toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
      {children}
      {end !== undefined ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  )
}

export type PropertyItem = { label: string; value: React.ReactNode; mono?: boolean | undefined; wide?: boolean | undefined }

/** Properties — key/value list for detail pages (label muted, value foreground); falsy items are skipped. */
export function Properties({ items, columns = 1 }: { items: readonly (PropertyItem | false | null | undefined)[]; columns?: 1 | 2 | undefined }) {
  return (
    <dl className={cn("grid min-w-0 gap-x-8 gap-y-2.5 text-sm", columns === 2 && "@xl/page:grid-cols-2")}>
      {items.filter((item): item is PropertyItem => Boolean(item)).map((item) => (
        <div key={item.label} className={cn("grid min-w-0 grid-cols-[9rem_minmax(0,1fr)] gap-4", item.wide && "@xl/page:col-span-2")}>
          <dt className="truncate text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0", item.mono ? "font-mono text-xs leading-5 break-words" : "break-words")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Inline — icon + text (or badge + text) on one line. */
export function Inline({ gap = "xs", wrap = false, children }: { gap?: "xs" | "sm" | undefined; wrap?: boolean | undefined; children: React.ReactNode }) {
  return <span className={cn("inline-flex min-w-0 items-center", gap === "xs" ? "gap-1.5" : "gap-2", wrap && "flex-wrap")}>{children}</span>
}

/** Grid — equal columns that collapse to one column on narrow containers (field pairs, choice cards). */
export function Grid({ columns = 2, gap = "md", children }: { columns?: 2 | 3 | undefined; gap?: Gap | undefined; children: React.ReactNode }) {
  return <div className={cn("grid min-w-0", gapClass[gap], columns === 2 ? "@xl/page:grid-cols-2" : "@xl/page:grid-cols-3")}>{children}</div>
}

/** Rows — a flush list of rows with rule dividers; put it in `<Panel padding="none">`. */
export function Rows({ label, children }: { label?: string | undefined; children: React.ReactNode }) {
  return <ul aria-label={label} className="min-w-0 divide-y">{children}</ul>
}
export function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex min-w-0 items-center gap-3 px-4 py-2 text-sm">{children}</li>
}

/** DisclosureRow — a Row that expands in place (assets, previews); content is separated by a rule. */
export function DisclosureRow({ summary, children }: { summary: React.ReactNode; children?: React.ReactNode | undefined }) {
  const [open, setOpen] = React.useState(false)
  if (children === undefined) return <Row>{summary}</Row>
  return (
    <li className="min-w-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {summary}
      </button>
      {open ? <div className="min-w-0 border-t px-4 py-3">{children}</div> : null}
    </li>
  )
}

/** Actions — a row of buttons (form footer, inline actions); `align="end"` for form submit rows. */
export function Actions({ align = "start", children }: { align?: "start" | "end" | "between" | undefined; children: React.ReactNode }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-2", align === "end" && "justify-end", align === "between" && "justify-between")}>{children}</div>
}

/** Centered — vertically centered column inside a Body (start screens: new conversation, onboarding). */
export function Centered({ title, description, children }: { title: string; description?: React.ReactNode | undefined; children?: React.ReactNode | undefined }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 pb-24">
      <div className="text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description !== undefined ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}
