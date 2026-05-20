import { AppProvider } from "@/context/AppContext"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { isWikiReaderPath, usePathname } from "@/lib/wiki-routes"
import "./App.css"

function AppRouter() {
  const pathname = usePathname()

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
