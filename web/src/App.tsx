import { useSyncExternalStore } from "react"
import { AppProvider } from "@/context/AppContext"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { isWikiReaderPath, PATH_CHANGE_EVENT } from "@/lib/wiki-routes"
import "./App.css"

function subscribePath(cb: () => void) {
  const onChange = () => cb()
  window.addEventListener("popstate", onChange)
  window.addEventListener(PATH_CHANGE_EVENT, onChange)

  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    origPush(...args)
    onChange()
  }
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    origReplace(...args)
    onChange()
  }

  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(PATH_CHANGE_EVENT, onChange)
    history.pushState = origPush
    history.replaceState = origReplace
  }
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
