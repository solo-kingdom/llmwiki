import { useRef, type ReactNode } from "react"
import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, GitBranch, List, Menu, Search } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { GraphPage } from "@/components/GraphPage"
import { DocumentViewer } from "@/components/DocumentViewer"
import { DocumentOutline } from "@/components/DocumentOutline"
import { WikiDocumentInfoBar } from "@/components/WikiDocumentInfo"
import { SearchModal } from "@/components/SearchModal"
import { AppHeaderBar } from "@/components/AppHeaderBar"
import { Button } from "@/components/ui/button"
import { Dialog } from "@base-ui/react/dialog"
import { useWikiReader } from "@/context/WikiReaderContext"
import { useT } from "@/i18n"
import {
  isWikiGraphPath,
  navigateTo,
  usePathname,
  wikiGraphHref,
  workbenchHref,
} from "@/lib/wiki-routes"
import type { OutlineItem } from "@/types"
import { cn } from "@/lib/utils"

export function WikiReaderLayout() {
  const t = useT()
  const pathname = usePathname()
  const isGraphView = isWikiGraphPath(pathname)
  const { currentDoc, loading, publicWikiEnabled, error } = useWikiReader()
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [outlineCollapsed, setOutlineCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollbarTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const hide = () => el.classList.add("wiki-scrollbar-hidden")
    const show = () => el.classList.remove("wiki-scrollbar-hidden")
    hide()

    const onScroll = () => {
      show()
      if (scrollbarTimerRef.current) {
        window.clearTimeout(scrollbarTimerRef.current)
      }
      scrollbarTimerRef.current = window.setTimeout(hide, 700)
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      if (scrollbarTimerRef.current) {
        window.clearTimeout(scrollbarTimerRef.current)
      }
    }
  }, [currentDoc?.id, loading])

  const hasOutline = outline.length > 0

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background">
      <AppHeaderBar
        className="mx-4 mt-2 mb-2"
        left={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <a href={workbenchHref()} className="text-lg font-bold text-point">
              LLMWiki
            </a>
            {publicWikiEnabled && (
              <span className="hidden rounded-md border border-point-border bg-point-soft px-2 py-0.5 text-xs text-point-foreground sm:inline">
                {t("wiki.public_reading")}
              </span>
            )}
          </>
        }
        right={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              title={t("wiki.search_shortcut")}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant={isGraphView ? "secondary" : "ghost"}
              size="sm"
              className="hidden gap-1 sm:inline-flex"
              onClick={() => navigateTo(wikiGraphHref())}
              title={t("wiki.graph_entry")}
            >
              <GitBranch className="h-4 w-4" />
              <span className="text-xs">{t("nav.graph")}</span>
            </Button>
            {hasOutline && !isGraphView && (
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOutlineOpen(true)}
              >
                <List className="h-4 w-4" />
              </Button>
            )}
            <a
              href={workbenchHref()}
              className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
              onClick={(e) => {
                e.preventDefault()
                navigateTo(workbenchHref())
              }}
            >
              {t("wiki.manage_workbench")}
            </a>
          </>
        }
      />

      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <main className="relative flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4">
        <aside
          className={cn(
            "hidden lg:flex h-full relative shrink-0 overflow-hidden transition-all duration-200 ease-out",
            sidebarCollapsed ? "w-0 min-w-0" : "w-72 min-w-72",
          )}
        >
          <div className="relative z-30 flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-sm backdrop-blur-sm">
            <Sidebar variant="reader" onSelect={() => setMobileMenuOpen(false)} />
            <CollapseEdge
              side="left"
              onClick={() => setSidebarCollapsed(true)}
              title={t("wiki.collapse_files")}
              icon={<ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />}
            />
          </div>
        </aside>

        {sidebarCollapsed && (
          <CollapseEdgeFloating
            side="left"
            onClick={() => setSidebarCollapsed(false)}
            title={t("wiki.expand_files")}
            icon={<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          />
        )}

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            sidebarCollapsed && "-ml-4",
            outlineCollapsed && "-mr-4",
          )}
        >
          {isGraphView ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-point-border bg-card/70 shadow-sm backdrop-blur-sm">
              <GraphPage />
            </div>
          ) : loading && !currentDoc ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground shadow-sm backdrop-blur-sm">
              {t("common.loading")}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-point-border bg-card/70 shadow-sm backdrop-blur-sm">
              {currentDoc && (
                <div className="shrink-0 border-b border-border/70 bg-point-soft px-4 py-2">
                  <WikiDocumentInfoBar doc={currentDoc} />
                </div>
              )}
              <div
                ref={scrollRef}
                className="wiki-scrollbar wiki-scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
              >
                <DocumentViewer
                  variant="reader"
                  onOutlineChange={setOutline}
                />
              </div>
            </div>
          )}
        </div>

        {hasOutline && !isGraphView && (
          <aside
            className={cn(
              "hidden lg:flex h-full relative shrink-0 overflow-hidden transition-all duration-200 ease-out",
              outlineCollapsed ? "w-0 min-w-0" : "w-72 min-w-72",
            )}
          >
            <div className="relative z-30 flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-sm backdrop-blur-sm">
              <DocumentOutline items={outline} variant="reader" />
              <CollapseEdge
                side="right"
                onClick={() => setOutlineCollapsed(true)}
                title={t("wiki.collapse_outline")}
                icon={<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              />
            </div>
          </aside>
        )}

        {hasOutline && outlineCollapsed && (
          <CollapseEdgeFloating
            side="right"
            onClick={() => setOutlineCollapsed(false)}
            title={t("wiki.expand_outline")}
            icon={<ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />}
          />
        )}
      </main>

      <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex h-full min-h-0 w-72 flex-col overflow-hidden border-r bg-card shadow-lg lg:hidden">
            <Sidebar variant="reader" onSelect={() => setMobileMenuOpen(false)} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />

      <Dialog.Root open={mobileOutlineOpen} onOpenChange={setMobileOutlineOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex h-full min-h-0 w-72 flex-col overflow-hidden border-l bg-card shadow-lg lg:hidden">
            <DocumentOutline items={outline} variant="reader" className="border-l-0" />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function CollapseEdge({
  side,
  onClick,
  title,
  icon,
}: {
  side: "left" | "right"
  onClick: () => void
  title: string
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute top-1/2 z-50 flex h-11 w-4 -translate-y-1/2 items-center justify-center",
        "cursor-pointer border border-border bg-card shadow-sm opacity-40 transition-all hover:w-5 hover:bg-accent hover:opacity-100",
        side === "left" && "right-0 rounded-l-md",
        side === "right" && "left-0 rounded-r-md",
      )}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  )
}

function CollapseEdgeFloating({
  side,
  onClick,
  title,
  icon,
}: {
  side: "left" | "right"
  onClick: () => void
  title: string
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute top-1/2 z-50 hidden h-11 w-4 -translate-y-1/2 items-center justify-center lg:flex",
        "cursor-pointer border border-border bg-card shadow-sm opacity-40 transition-all hover:w-5 hover:bg-accent hover:opacity-100",
        side === "left" && "left-0 rounded-r-md",
        side === "right" && "right-0 rounded-l-md",
      )}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  )
}
