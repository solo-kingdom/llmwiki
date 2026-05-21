import { AppProvider, useApp } from "@/context/AppContext"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { I18nProvider, useI18n } from "@/i18n"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { isWikiReaderPath, usePathname } from "@/lib/wiki-routes"
import { useEffect, useCallback } from "react"
import "./App.css"

function I18nSync() {
  const { settings, loadSettings } = useApp()
  const { setLang } = useI18n()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (settings?.ui_language) {
      setLang(settings.ui_language as "zh" | "en")
    }
  }, [settings?.ui_language, setLang])

  return null
}

function WorkbenchShell() {
  const { settings } = useApp()
  const handleLangChange = useCallback((_lang: "zh" | "en") => {
    // The save is handled by the settings page; this callback is for future direct lang changes
  }, [])

  return (
    <I18nProvider
      initialLang={(settings?.ui_language as "zh" | "en") || "zh"}
      onLangChange={handleLangChange}
    >
      <I18nSync />
      <WorkbenchLayout />
    </I18nProvider>
  )
}

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
      <WorkbenchShell />
    </AppProvider>
  )
}

export default function App() {
  return <AppRouter />
}
