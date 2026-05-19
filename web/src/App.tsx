import { useState, useMemo } from "react"
import { AppProvider, useApp } from "@/context/AppContext"
import { Sidebar } from "@/components/Sidebar"
import { DocumentViewer } from "@/components/DocumentViewer"
import { SettingsPage } from "@/components/SettingsPage"
import { IngestChat } from "@/components/IngestChat"
import { JobsPage } from "@/components/JobsPage"
import { WarningPopover } from "@/components/WarningPopover"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import "./App.css"

type View = "ingest" | "jobs" | "wiki" | "settings"

function AppLayout() {
  const [view, setView] = useState<View>("ingest")
  const { capabilities } = useApp()

  const missingDeps = useMemo(() => {
    if (!capabilities) return []
    return capabilities.runtime_dependencies.filter((d) => !d.found)
  }, [capabilities])

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as View)}
      className="flex h-screen flex-col"
    >
      <header className="flex items-center border-b px-4 py-2">
        <h1 className="text-base font-bold mr-4">LLMWiki</h1>
        <TabsList className="overflow-x-auto">
          <div className="flex items-center gap-1">
            <TabsTrigger value="ingest">Ingest</TabsTrigger>
            <WarningPopover missingDeps={missingDeps} />
          </div>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="wiki">Wiki</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="ingest" className="flex flex-1 min-h-0">
        <IngestChat />
      </TabsContent>
      <TabsContent value="jobs" className="flex flex-1 min-h-0">
        <JobsPage />
      </TabsContent>
      <TabsContent value="wiki" className="flex flex-1 min-h-0">
        <Sidebar />
        <DocumentViewer />
      </TabsContent>
      <TabsContent value="settings" className="flex flex-1 min-h-0">
        <SettingsPage />
      </TabsContent>
    </Tabs>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  )
}
