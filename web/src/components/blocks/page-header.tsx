/**
 * PageHeader — title, optional breadcrumbs, one primary action, up to two secondary actions.
 * Secondary actions fold into an overflow menu when the header container is narrow.
 */
import * as React from "react"
import { MoreHorizontalIcon } from "lucide-react"
import { cn } from "cn"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { AppLink } from "@/components/blocks/router"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { vocab } from "@/lib/vocab"

export type HeaderAction = { label: string; icon?: React.ReactNode | undefined; onSelect: () => void; destructive?: boolean | undefined; disabled?: boolean | undefined }

export function PageHeader({
  title, breadcrumbs = [], primary, actions = [], sidebarTrigger = true, leading, className,
}: {
  title: string
  breadcrumbs?: { label: string; to: string }[] | undefined
  /** The single most important action (a <Button> or a link styled as one). */
  primary?: React.ReactNode | undefined
  /** At most two are shown inline on wide containers; the rest live in the overflow menu. */
  actions?: HeaderAction[] | undefined
  /** Render the shell's sidebar toggle (requires the shell's SidebarProvider). */
  sidebarTrigger?: boolean | undefined
  /** Rendered after the sidebar toggle, e.g. `<ListPaneTrigger />` of a ListDetailLayout. */
  leading?: React.ReactNode | undefined
  className?: string | undefined
}) {
  const [ref, width] = useContainerWidth<HTMLElement>()
  const wide = width === 0 || width >= 560
  // destructive actions never sit inline: they always end the overflow menu
  const safe = actions.filter((action) => !action.destructive)
  const inline = wide ? safe.slice(0, 2) : []
  const overflow = [...safe.slice(inline.length), ...actions.filter((action) => action.destructive)]
  return (
    <header ref={ref} className={cn("@container/header flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3", className)}>
      {sidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null}
      {leading}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.to}>
              <BreadcrumbItem className="hidden @lg/header:inline-flex">
                <BreadcrumbLink asChild><AppLink to={crumb.to} className="max-w-40 truncate">{crumb.label}</AppLink></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden @lg/header:inline-flex" />
            </React.Fragment>
          ))}
          <BreadcrumbItem className="min-w-0"><BreadcrumbPage><h1 className="truncate text-sm font-medium">{title}</h1></BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {inline.map((action) => (
        <Button key={action.label} variant="ghost" size="sm" onClick={action.onSelect} disabled={action.disabled}
          className={cn(action.destructive && "text-destructive hover:text-destructive")}>
          {action.icon}{action.label}
        </Button>
      ))}
      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={vocab.copy.more}><MoreHorizontalIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((action) => (
              <DropdownMenuItem key={action.label} onSelect={action.onSelect} disabled={action.disabled} variant={action.destructive ? "destructive" : "default"}>
                {action.icon}{action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {primary}
    </header>
  )
}
