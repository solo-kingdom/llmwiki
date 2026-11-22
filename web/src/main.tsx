import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router"
import { NotFound, RouteError } from "@/components/blocks/app-errors"
import { ConfirmProvider } from "@/components/blocks/confirm"
import { ThemeProvider } from "@/components/blocks/theme"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppProvider } from "@/context/app-context"
import { ChatPage } from "./pages/chat"
import { GraphPage } from "./pages/graph"
import { HelpPage } from "./pages/help"
import { JobsPage } from "./pages/jobs"
import { LogsPage } from "./pages/logs"
import { SettingsLayout, ModelsSection, IngestSection, AccessSection, IntegrationsSection, RulesSection } from "./pages/settings"
import { TimelinePage } from "./pages/timeline"
import { WikiReaderPage } from "./pages/wiki"
import { Root } from "./root"
import "./index.css"

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

const router = createBrowserRouter([{
  element: <Root />, errorElement: <RouteError />, children: [
    { index: true, element: <ChatPage /> },
    { path: "chat/:id", element: <ChatPage /> },
    { path: "jobs", element: <JobsPage /> },
    { path: "timeline", element: <TimelinePage /> },
    { path: "logs", element: <LogsPage /> },
    { path: "settings", element: <SettingsLayout />, children: [
      { index: true, element: <Navigate to="models" replace /> },
      { path: "models", element: <ModelsSection /> },
      { path: "ingest", element: <IngestSection /> },
      { path: "access", element: <AccessSection /> },
      { path: "integrations", element: <IntegrationsSection /> },
      { path: "rules", element: <RulesSection /> },
    ] },
    { path: "help", element: <HelpPage /> },
    { path: "wiki", element: <WikiReaderPage /> },
    { path: "wiki/graph", element: <GraphPage /> },
    { path: "wiki/:id", element: <WikiReaderPage /> },
    { path: "*", element: <NotFound /> },
  ],
}])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><ConfirmProvider><TooltipProvider><AppProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </AppProvider></TooltipProvider></ConfirmProvider></ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
