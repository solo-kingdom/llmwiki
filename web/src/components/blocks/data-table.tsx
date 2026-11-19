/**
 * DataTable — the collection pattern on TanStack Table + shadcn table.
 *
 * Construction guarantees (do not re-implement per page):
 * - one column definition drives header AND cells (no drift between them);
 * - `meta.kind` decides alignment, font and truncation; `meta.priority` hides columns by the
 *   CONTAINER width (not the viewport); below `stackBelow` px the table becomes a two-line list;
 * - rows navigate through a real anchor (RowLink) or select with aria-selected — never <tr onClick>;
 * - `paging` is required: every collection declares whether the API returned all of it ("complete"), a page it
 *   keeps extending (load more), or a page-numbered collection ({ mode: "pages", page, pageSize, total, onPage }).
 *   The footer never presents the loaded count as the total: load-more footers show the server total, or
 *   "loaded X / total Y", or "loaded X, more"; when there are more they render a load-more button and an
 *   auto-loading sentinel (IntersectionObserver) at the end of the rows; pages footers show the exact server
 *   total, the page position and 上一页 / 下一页 (optional page-size select), never a guessed total;
 * - more than VIRTUALIZE_ABOVE rows render windowed (TanStack Virtual over the enclosing [data-scroll-region]):
 *   only visible rows (+overscan) are in the DOM, gaps become spacer rows, the focused row stays mounted,
 *   rows keep aria-rowindex; `virtualize` overrides the threshold; scroll anchoring is off for windowed rows
 *   (spacer changes would otherwise make the browser re-anchor and jump);
 * - the header row is sticky inside the scroll region (opaque band, bottom rule drawn as a shadow so it
 *   survives border-collapse); the table container clips horizontally instead of scrolling so the
 *   region stays the only scroller;
 * - `frame="bordered"` (default) draws the region: outer border, radius, header band, row rules.
 *   Use `frame="flush"` only when the table already sits inside a bordered surface (Card, Sheet) — never both.
 */
import * as React from "react"
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type Row, type RowData, type SortingState,
} from "@tanstack/react-table"
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual"
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RowLink } from "@/components/blocks/row-link"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { vocab } from "@/lib/vocab"

export type ColumnKind = "primary" | "text" | "id" | "number" | "time" | "status" | "tags" | "actions"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Rendering contract of the column. Default "text". */
    kind?: ColumnKind | undefined
    /** 1 = always visible (default), 2 = hidden below ~42rem container, 3 = hidden below ~56rem. */
    priority?: 1 | 2 | 3 | undefined
  }
}

const kindClass: Record<ColumnKind, string> = {
  primary: "w-full max-w-0 min-w-48 font-medium text-foreground",
  text: "max-w-64 truncate text-muted-foreground",
  id: "whitespace-nowrap",
  number: "text-right tabular-nums whitespace-nowrap",
  time: "text-right tabular-nums whitespace-nowrap text-muted-foreground",
  status: "whitespace-nowrap",
  tags: "max-w-56",
  actions: "relative z-10 w-px py-0 text-right whitespace-nowrap",
}
const priorityClass = { 1: "", 2: "hidden @2xl/table:table-cell", 3: "hidden @4xl/table:table-cell" } as const

export type LoadMorePaging = {
  /** Server total when the API reports one. */
  total?: number | undefined
  /** The API reported more (a next cursor, or a full page at the requested limit). */
  hasMore: boolean
  loadingMore?: boolean | undefined
  onLoadMore: () => void
  /** No more can be loaded but the API capped the result (full page at its maximum limit). */
  capped?: boolean | undefined
}

export type PagesPaging = {
  mode: "pages"
  /** 1-based page. */
  page: number
  pageSize: number
  /** Exact total of the filtered collection as reported by the API — the footer never guesses. */
  total: number
  onPage: (page: number) => void
  /** The current page request is in flight (the pager stays disabled). */
  loading?: boolean | undefined
  /** Optional page-size control in the footer. */
  pageSizeOptions?: readonly number[] | undefined
  onPageSize?: ((size: number) => void) | undefined
}

export type Paging = "complete" | LoadMorePaging | PagesPaging

/** Limit-based paging for APIs without a cursor: a full page at the requested limit means "more". */
export function useLimitPaging(step: number, max: number) {
  const [limit, setLimit] = React.useState(step)
  return {
    limit,
    paging: (loaded: number, loading = false): Paging => ({
      hasMore: loaded >= limit && limit < max, capped: loaded >= max, loadingMore: loading,
      onLoadMore: () => setLimit((value) => Math.min(value + step, max)),
    }),
  }
}

/** Row count above which DataTable windows its rows (proposal rule: > 200 rows virtualize). */
export const VIRTUALIZE_ABOVE = 200

/** Window `count` rows inside the enclosing scroll region. Returns the slices to render with the gap before each. */
function useRowWindow(count: number, enabled: boolean, estimate: number, anchor: React.RefObject<HTMLElement | null>) {
  const [region, setRegion] = React.useState<HTMLElement | null>(null)
  const [margin, setMargin] = React.useState(0)
  const focused = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    const el = anchor.current
    const scroller = el?.closest<HTMLElement>("[data-scroll-region]") ?? null
    setRegion(scroller)
    if (el && scroller) setMargin(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop)
  }, [anchor, enabled, count])
  const virtualizer = useVirtualizer({
    count, enabled: enabled && region !== null, estimateSize: () => estimate, overscan: 8, scrollMargin: margin,
    getScrollElement: () => region,
    rangeExtractor: (range: Range) => {
      const out = defaultRangeExtractor(range)
      const f = focused.current
      return f !== null && f < count && !out.includes(f) ? [...out, f].sort((a, b) => a - b) : out
    },
  })
  if (!enabled || region === null) return null
  const items = virtualizer.getVirtualItems()
  let end = margin
  const slices = items.map((item) => { const gap = item.start - end; end = item.end; return { index: item.index, gap } })
  return {
    slices, after: virtualizer.getTotalSize() + margin - end, measure: virtualizer.measureElement,
    onFocusRow: (index: number) => { focused.current = index },
  }
}

function LoadMoreSentinel({ onLoadMore, disabled }: { onLoadMore: () => void; disabled: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const latest = React.useRef(onLoadMore)
  latest.current = onLoadMore
  React.useEffect(() => {
    const node = ref.current
    if (node === null || disabled || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) latest.current() }, { rootMargin: "200px" })
    observer.observe(node)
    return () => observer.disconnect()
  }, [disabled])
  return <div ref={ref} data-load-more="sentinel" aria-hidden="true" className="h-px" />
}

/** Page-number controls for `{ mode: "pages" }`: 上一页 / 第 n / 共 P 页 / 下一页 (+ optional page-size select). */
function PageControls({ paging, pageCount }: { paging: PagesPaging; pageCount: number }) {
  return (
    <div className="flex items-center gap-2">
      {paging.pageSizeOptions !== undefined && paging.onPageSize !== undefined ? (
        <div className="flex items-center gap-1.5">
          <span>{vocab.copy.pageSize}</span>
          <Select value={String(paging.pageSize)} onValueChange={(value) => paging.onPageSize?.(Number(value))}>
            <SelectTrigger size="sm" aria-label={vocab.copy.pageSize} className="w-16"><SelectValue /></SelectTrigger>
            <SelectContent>{paging.pageSizeOptions.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}
      <span className="tabular-nums">{vocab.copy.pageOf(paging.page, pageCount)}</span>
      <Button data-page="prev" variant="outline" size="sm" disabled={paging.page <= 1 || paging.loading === true} onClick={() => paging.onPage(paging.page - 1)}>{vocab.copy.previousPage}</Button>
      <Button data-page="next" variant="outline" size="sm" disabled={paging.page >= pageCount || paging.loading === true} onClick={() => paging.onPage(paging.page + 1)}>{vocab.copy.nextPage}</Button>
    </div>
  )
}

export type DataTableProps<T> = {
  /** Accessible name of the table (rendered as an sr-only caption). */
  label: string
  columns: ColumnDef<T, unknown>[]
  data: T[]
  getRowId: (row: T) => string
  /** Row navigation (preferred when a detail page exists). */
  rowHref?: ((row: T) => string) | undefined
  /** Accessible name of the row link; defaults to the first primary cell text. */
  rowLabel?: ((row: T) => string) | undefined
  /** Master-detail selection instead of navigation. */
  selectedId?: string | undefined
  onSelect?: ((row: T) => void) | undefined
  /** How much of the collection is loaded. "complete" only when the API returned the whole collection. */
  paging: Paging
  /**
   * Server/URL-owned sort. When `sorting` is passed the table is controlled and does not reorder rows
   * (the server returns them sorted); omit it and sorting is client-side over the loaded rows.
   */
  sorting?: SortingState | undefined
  onSortingChange?: ((sorting: SortingState) => void) | undefined
  /** "bordered" (default) frames the table; "flush" when a parent Card/Sheet already draws the border. */
  frame?: "bordered" | "flush" | undefined
  /** Container width (px) under which rows render as a two-line list. */
  stackBelow?: number | undefined
  /** Window the rows; default: on when more than VIRTUALIZE_ABOVE rows. */
  virtualize?: boolean | undefined
  className?: string | undefined
}

export function DataTable<T>({
  label, columns, data, getRowId, rowHref, rowLabel, selectedId, onSelect,
  paging, sorting: controlled, onSortingChange, frame = "bordered", stackBelow = 480, virtualize, className,
}: DataTableProps<T>) {
  const [local, setLocal] = React.useState<SortingState>([])
  const sorting = controlled ?? local
  const table = useReactTable({
    data, columns, getRowId: (row) => getRowId(row), state: { sorting }, manualSorting: controlled !== undefined,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      if (controlled === undefined) setLocal(next)
      onSortingChange?.(next)
    },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableSortingRemoval: true,
    defaultColumn: { enableSorting: false }, // opt in per column: `enableSorting: true`
  })
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const stacked = width > 0 && width < stackBelow
  const rows = table.getRowModel().rows
  const bodyRef = React.useRef<HTMLElement | null>(null)
  const win = useRowWindow(rows.length, virtualize ?? rows.length > VIRTUALIZE_ABOVE, stacked ? 52 : 40, bodyRef)
  /** Rows to render, each with the spacer height before it (all rows, no spacers, when not windowed). */
  const visible: { row: Row<T>; pos: number; gap: number }[] = win === null ? rows.map((row, pos) => ({ row, pos, gap: 0 }))
    : win.slices.flatMap(({ index, gap }) => (rows[index] ? [{ row: rows[index], pos: index, gap }] : []))
  const after = win?.after ?? 0

  const rowProps = (row: Row<T>, pos: number) => {
    const selected = selectedId !== undefined && row.id === selectedId
    return {
      "data-state": selected ? "selected" : undefined,
      // rows (table) support aria-selected; list items do not, so the stacked list uses aria-current
      ...(onSelect === undefined ? {} : stacked ? { "aria-current": selected ? ("true" as const) : undefined } : { "aria-selected": selected }),
      tabIndex: onSelect !== undefined ? 0 : undefined,
      "data-index": pos, ref: win?.measure,
      onFocus: win === null ? undefined : () => win.onFocusRow(pos),
      onKeyDown: onSelect !== undefined ? (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.original) } } : undefined,
      onClick: onSelect !== undefined ? () => onSelect(row.original) : undefined,
      className: cn("relative", (rowHref !== undefined || onSelect !== undefined) && "cursor-pointer", onSelect !== undefined && "focus-visible:bg-muted/50 focus-visible:outline-none"),
    }
  }
  const linkFor = (row: Row<T>) => {
    if (rowHref === undefined) return null
    const primary = row.getVisibleCells().find((cell) => cell.column.columnDef.meta?.kind === "primary")
    const name = rowLabel?.(row.original) ?? String(primary?.getValue() ?? row.id)
    return <RowLink to={rowHref(row.original)} label={name} />
  }

  const bordered = frame === "bordered"
  const complete = paging === "complete"
  const pages = !complete && "mode" in paging ? paging : null
  const more = !complete && "onLoadMore" in paging ? paging : null
  const total = complete ? data.length : pages !== null ? pages.total : more?.total
  const pageCount = pages === null ? 0 : Math.max(1, Math.ceil(pages.total / pages.pageSize))
  return (
    <div ref={ref} data-surface={bordered ? "panel" : undefined} className={cn("@container/table min-w-0", bordered && "overflow-clip rounded-lg border bg-card", className)}>
      {stacked ? (
        <ul ref={(el) => { bodyRef.current = el }} aria-label={label} className={cn("divide-y", !bordered && "border-y", win !== null && "[overflow-anchor:none]")}>
          {visible.map(({ row, pos, gap }) => {
            const cells = row.getVisibleCells()
            const primary = cells.find((cell) => cell.column.columnDef.meta?.kind === "primary") ?? cells[0]
            if (primary === undefined) return null
            const actions = cells.find((cell) => cell.column.columnDef.meta?.kind === "actions")
            const meta = cells.filter((cell) => cell !== primary && cell !== actions && (cell.column.columnDef.meta?.priority ?? 1) === 1)
            const props = rowProps(row, pos)
            return (
              <React.Fragment key={row.id}>
              {gap > 0 ? <li aria-hidden="true" data-spacer="" style={{ height: gap }} /> : null}
              <li {...props} className={cn(props.className, "flex items-center gap-3 px-3 py-2 hover:bg-muted/50 data-[state=selected]:bg-muted")}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{flexRender(primary.column.columnDef.cell, primary.getContext())}</div>
                  {meta.length > 0 ? (
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {meta.map((cell) => <span key={cell.id} className="min-w-0 truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>)}
                    </div>
                  ) : null}
                </div>
                {actions !== undefined ? <div className="relative z-10 shrink-0">{flexRender(actions.column.columnDef.cell, actions.getContext())}</div> : null}
                {linkFor(row)}
              </li>
              </React.Fragment>
            )
          })}
          {after > 0 ? <li aria-hidden="true" data-spacer="" style={{ height: after }} /> : null}
        </ul>
      ) : (
        <Table containerClassName="overflow-x-clip" aria-rowcount={rows.length + 1}>
          <caption className="sr-only">{label}</caption>
          <TableHeader data-sticky="header" className="sticky top-0 z-20 bg-card [&_tr]:border-b-0">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className={cn("hover:bg-transparent", bordered && "bg-muted/50")}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  const kind = meta?.kind ?? "text"
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn("h-9 text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]", (kind === "number" || kind === "time" || kind === "actions") && "text-right", priorityClass[meta?.priority ?? 1])}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()} className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ArrowUpIcon className="size-3" /> : sorted === "desc" ? <ArrowDownIcon className="size-3" /> : <ChevronsUpDownIcon className="size-3 opacity-50" />}
                        </button>
                      ) : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody ref={(el) => { bodyRef.current = el }} className={cn(win !== null && "[overflow-anchor:none]")}>
            {visible.map(({ row, pos, gap }) => (
              <React.Fragment key={row.id}>
              {gap > 0 ? <tr aria-hidden="true" data-spacer="" style={{ height: gap }} /> : null}
              <TableRow aria-rowindex={pos + 2} {...rowProps(row, pos)}>
                {row.getVisibleCells().map((cell, index) => {
                  const meta = cell.column.columnDef.meta
                  const kind = meta?.kind ?? "text"
                  return (
                    <TableCell key={cell.id} className={cn("h-10 py-1.5", kindClass[kind], priorityClass[meta?.priority ?? 1])}>
                      {kind === "primary" ? <div className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div> : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      {index === 0 ? linkFor(row) : null}
                    </TableCell>
                  )
                })}
              </TableRow>
              </React.Fragment>
            ))}
            {after > 0 ? <tr aria-hidden="true" data-spacer="" style={{ height: after }} /> : null}
          </TableBody>
        </Table>
      )}
      {more !== null && more.hasMore ? <LoadMoreSentinel onLoadMore={more.onLoadMore} disabled={more.loadingMore === true} /> : null}
      <div data-slot="collection-footer" data-loaded={rows.length} data-total={total}
        data-paging={pages === null ? undefined : "pages"}
        data-has-more={pages !== null ? (pages.page < pageCount ? "true" : undefined) : more?.hasMore === true ? "true" : undefined}
        data-capped={more?.capped === true ? "true" : undefined}
        className={cn("flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground", bordered && "border-t")}>
        <span role="status">{pages !== null ? vocab.copy.totalItems(pages.total) : vocab.copy.count(rows.length, { total, more: more?.hasMore === true, capped: more?.capped === true })}</span>
        {pages !== null ? <PageControls paging={pages} pageCount={pageCount} /> : null}
        {more !== null && more.hasMore ? (
          <Button data-load-more="button" variant="ghost" size="sm" onClick={more.onLoadMore} disabled={more.loadingMore === true}>{more.loadingMore === true ? vocab.copy.loadingMore : vocab.copy.loadMore}</Button>
        ) : null}
      </div>
    </div>
  )
}
