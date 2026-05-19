import { useState, useMemo, type ReactNode } from "react"
import { AppProvider, useApp } from "@/context/AppContext"
import { SettingsPage } from "@/components/SettingsPage"
import { IngestChat } from "@/components/IngestChat"
import { JobsPage } from "@/components/JobsPage"
import { WikiPage } from "@/components/WikiPage"
import { WarningPopover } from "@/components/WarningPopover"
import { cn } from "@/lib/utils"
import "./App.css"

type View = "ingest" | "jobs" | "wiki" | "settings"

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: "ingest", label: "Ingest" },
  { id: "jobs", label: "Jobs" },
  { id: "wiki", label: "Wiki" },
  { id: "settings", label: "Settings" },
]

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

function AppLayout() {
  const [view, setView] = useState<View>("ingest")
  const { capabilities } = useApp()

  const missingDeps = useMemo(() => {
    if (!capabilities) return []
    return capabilities.runtime_dependencies.filter((d) => !d.found)
  }, [capabilities])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex justify-center px-4 pt-3">
        <div className="inline-flex items-center gap-4 rounded-xl bg-header-bg px-5 py-2.5 shadow-sm">
          <h1 className="text-base font-bold">LLMWiki</h1>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) =>
              item.id === "ingest" ? (
                <div key={item.id} className="flex items-center gap-1">
                  <NavButton
                    active={view === item.id}
                    onClick={() => setView(item.id)}
                  >
                    {item.label}
                  </NavButton>
                  <WarningPopover missingDeps={missingDeps} />
                </div>
              ) : (
                <NavButton
                  key={item.id}
                  active={view === item.id}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </NavButton>
              ),
            )}
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {view === "ingest" && (
          <div className="flex min-h-0 flex-1">
            <IngestChat />
          </div>
        )}
        {view === "jobs" && <JobsPage />}
        {view === "wiki" && (
          <div className="relative flex min-h-0 flex-1">
            <WikiPage />
          </div>
        )}
        {view === "settings" && <SettingsPage />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  )
}
