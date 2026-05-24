import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
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
  directIngestHref,
  getWorkbenchViewFromPath,
  navigateTo,
  usePathname,
  wikiReaderHref,
  workbenchHref,
  workbenchViewHref,
  type WorkbenchView,
} from "@/lib/wiki-routes"
import type { MessageKey } from "@/i18n"

const NAV_ITEMS: { id: WorkbenchView; labelKey: MessageKey }[] = [
  { id: "chat", labelKey: "nav.chat" },
  { id: "jobs", labelKey: "nav.jobs" },
  { id: "timeline", labelKey: "nav.timeline" },
  { id: "logs", labelKey: "nav.logs" },
  { id: "settings", labelKey: "nav.settings" },
]

const LEGACY_HASH_VIEWS = new Set<string>([
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
  const t = useT()

  useEffect(() => {
    getVCStatus()
      .then((s) => setVcEnabled(s.enabled))
      .catch(() => setVcEnabled(false))
  }, [])

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "")
    if (!raw) return
    if (raw === "ingest") {
      navigateTo(directIngestHref())
      return
    }
    if (LEGACY_HASH_VIEWS.has(raw)) {
      navigateTo(workbenchViewHref(raw as WorkbenchView))
    }
  }, [])

  useEffect(() => {
    if (pathname === "/ingest") {
      navigateTo(directIngestHref())
    }
  }, [pathname])

  useEffect(() => {
    if (pathname === "/review") {
      navigateTo(workbenchHref())
    }
  }, [pathname])

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
             <span className="text-lg font-bold text-point">{t("app.title")}</span>
          }
          right={
            <>
              <nav className="flex items-center gap-1">
                {NAV_ITEMS.filter(
                  (item) => item.id !== "timeline" || vcEnabled === true,
                ).map((item) =>
                  item.id === "chat" ? (
                    <div key={item.id} className="flex items-center gap-1">
                      <NavButton
                        active={view === item.id}
                        onClick={() => navigateView(item.id)}
                      >
                        {t(item.labelKey)}
                      </NavButton>
                      <WarningPopover missingDeps={missingDeps} />
                    </div>
                  ) : (
                    <NavButton
                      key={item.id}
                      active={view === item.id}
                      onClick={() => navigateView(item.id)}
                    >
                      {t(item.labelKey)}
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
                {t("nav.wiki")}
              </a>
            </>
          }
        />

        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            view === "chat" ? "pb-2" : "pb-4",
          )}
        >
          {view === "chat" && (
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
