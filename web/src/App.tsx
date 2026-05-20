import { useSyncExternalStore } from "react"
import { AppProvider } from "@/context/AppContext"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { isWikiReaderPath } from "@/lib/wiki-routes"
import "./App.css"

function subscribePath(cb: () => void) {
  window.addEventListener("popstate", cb)
  return () => window.removeEventListener("popstate", cb)
}

function getPathname() {
  return window.location.pathname
}

function AppRouter() {
  const pathname = useSyncExternalStore(subscribePath, getPathname, getPathname)

  if (isWikiReaderPath(pathname)) {
    return (
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>
    )
  }

  return (
    <AppProvider>
      <WorkbenchLayout />
    </AppProvider>
  )
}

export default function App() {
  return <AppRouter />
}
