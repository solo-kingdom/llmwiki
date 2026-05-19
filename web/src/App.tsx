import { useState } from "react"
import { AppProvider } from "@/context/AppContext"
import { Sidebar } from "@/components/Sidebar"
import { DocumentViewer } from "@/components/DocumentViewer"
import { SettingsPage } from "@/components/SettingsPage"
import { IngestHub } from "@/components/IngestHub"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import "./App.css"

type View = "ingest" | "wiki" | "settings"

function AppLayout() {
  const [view, setView] = useState<View>("ingest")

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as View)}
      className="flex h-screen flex-col"
    >
      <header className="flex items-center border-b px-4 py-2">
        <h1 className="text-base font-bold mr-4">LLMWiki</h1>
        <TabsList>
          <TabsTrigger value="ingest">Ingest</TabsTrigger>
          <TabsTrigger value="wiki">Wiki</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="ingest" className="flex flex-1 min-h-0">
        <IngestHub />
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
