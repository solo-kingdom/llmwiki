import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useApp } from "@/context/AppContext"
import { SettingsPage } from "@/components/SettingsPage"
import { IngestChat } from "@/components/IngestChat"
import { JobsPage } from "@/components/JobsPage"
import { LogsPage } from "@/components/LogsPage"
import { TimelinePage } from "@/components/TimelinePage"
import { WarningPopover } from "@/components/WarningPopover"
import { AppHeaderBar } from "@/components/AppHeaderBar"
import { WorkbenchContentShell } from "@/components/WorkbenchContentShell"
import { cn } from "@/lib/utils"
import { getVCStatus } from "@/lib/api"
import {
  getWorkbenchViewFromPath,
  navigateTo,
  usePathname,
  wikiReaderHref,
  workbenchHref,
  workbenchViewHref,
  type WorkbenchView,
} from "@/lib/wiki-routes"

const NAV_ITEMS: { id: WorkbenchView; label: string }[] = [
  { id: "ingest", label: "Ingest" },
  { id: "jobs", label: "Jobs" },
  { id: "timeline", label: "Timeline" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
]

const LEGACY_HASH_VIEWS = new Set<WorkbenchView>([
  "jobs",
  "settings",
  "timeline",
  "logs",
])

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function WorkbenchLayout() {
  const pathname = usePathname()
  const view = getWorkbenchViewFromPath(pathname)
  const [vcEnabled, setVcEnabled] = useState<boolean | null>(null)
  const { capabilities } = useApp()

  useEffect(() => {
    getVCStatus()
      .then((s) => setVcEnabled(s.enabled))
      .catch(() => setVcEnabled(false))
  }, [])

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "")
    if (LEGACY_HASH_VIEWS.has(raw as WorkbenchView)) {
      navigateTo(workbenchViewHref(raw as WorkbenchView))
    }
  }, [])

  useEffect(() => {
    if (vcEnabled === null) return
    if (view === "timeline" && !vcEnabled) {
      navigateTo(workbenchHref())
    }
  }, [view, vcEnabled])

  const missingDeps = useMemo(() => {
    if (!capabilities) return []
    return capabilities.runtime_dependencies.filter((d) => !d.found)
  }, [capabilities])

  const navigateView = (id: WorkbenchView) => {
    navigateTo(workbenchViewHref(id))
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <WorkbenchContentShell>
        <AppHeaderBar
          className="mt-2 mb-2"
          left={
            <span className="text-lg font-bold text-point">LLMWiki</span>
          }
          right={
            <>
              <nav className="flex items-center gap-1">
                {NAV_ITEMS.filter(
                  (item) => item.id !== "timeline" || vcEnabled === true,
                ).map((item) =>
                  item.id === "ingest" ? (
                    <div key={item.id} className="flex items-center gap-1">
                      <NavButton
                        active={view === item.id}
                        onClick={() => navigateView(item.id)}
                      >
                        {item.label}
                      </NavButton>
                      <WarningPopover missingDeps={missingDeps} />
                    </div>
                  ) : (
                    <NavButton
                      key={item.id}
                      active={view === item.id}
                      onClick={() => navigateView(item.id)}
                    >
                      {item.label}
                    </NavButton>
                  ),
                )}
              </nav>
              <a
                href={wikiReaderHref()}
                className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                onClick={(e) => {
                  e.preventDefault()
                  navigateTo(wikiReaderHref())
                }}
              >
                Wiki
              </a>
            </>
          }
        />

        <main className="flex min-h-0 flex-1 flex-col pb-4">
          {view === "ingest" && (
            <div className="flex min-h-0 flex-1">
              <IngestChat />
            </div>
          )}
          {view === "jobs" && <JobsPage />}
          {view === "timeline" && vcEnabled === true && <TimelinePage />}
          {view === "logs" && <LogsPage />}
          {view === "settings" && <SettingsPage />}
        </main>
      </WorkbenchContentShell>
    </div>
  )
}
