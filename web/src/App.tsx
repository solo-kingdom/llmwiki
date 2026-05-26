import { AppProvider, useApp } from "@/context/AppContext"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { I18nProvider, useI18n } from "@/i18n"
import { WorkbenchLayout } from "@/components/WorkbenchLayout"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import {
  isWikiReaderPath,
  navigateTo,
  usePathname,
  wikiGraphHref,
} from "@/lib/wiki-routes"
import { useEffect } from "react"
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

function AppRouter() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === "/graph") {
      navigateTo(wikiGraphHref())
    }
  }, [pathname])

  if (isWikiReaderPath(pathname)) {
    return (
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>
    )
  }

  return (
    <AppProvider>
      <I18nSync />
      <WorkbenchLayout />
    </AppProvider>
  )
}

export default function App() {
  return (
    <I18nProvider bootstrapFromSettings>
      <AppRouter />
    </I18nProvider>
  )
}
