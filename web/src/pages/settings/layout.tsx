import { BarChart3Icon, CpuIcon, DatabaseIcon, HardDriveIcon, KeyRoundIcon, PlugIcon, ScrollTextIcon } from "lucide-react"
import { Outlet } from "react-router"
import { SectionLayout, type SectionNavItem } from "@/components/blocks/section-nav"
import { ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Page } from "@/components/blocks/surfaces"
import { useApp } from "@/context/app-context"

/** One route per section; `/settings` redirects to the first (see main.tsx). */
export const SETTINGS_SECTIONS: SectionNavItem[] = [
  { label: "模型与 Harness", to: "/settings/models", icon: <CpuIcon className="llmwiki-tone-indigo" /> },
  { label: "摄入与检索", to: "/settings/ingest", icon: <DatabaseIcon className="llmwiki-tone-cyan" /> },
  { label: "存储", to: "/settings/storage", icon: <HardDriveIcon className="llmwiki-tone-teal" /> },
  { label: "访问控制", to: "/settings/access", icon: <KeyRoundIcon className="llmwiki-tone-amber" /> },
  { label: "接口统计", to: "/settings/api-stats", icon: <BarChart3Icon className="llmwiki-tone-indigo" /> },
  { label: "外部集成", to: "/settings/integrations", icon: <PlugIcon className="llmwiki-tone-violet" /> },
  { label: "知识库规则", to: "/settings/rules", icon: <ScrollTextIcon className="llmwiki-tone-emerald" /> },
]

export function SettingsLayout() {
  const { settings, isLoading, error, refresh } = useApp()
  if (isLoading) return <RowsSkeleton rows={10} />
  if (error) return <ErrorState error={error} onRetry={() => void refresh()} />
  if (settings === undefined) return <RowsSkeleton rows={10} />
  return (
    <Page title="设置" layout="fill">
      <SectionLayout items={SETTINGS_SECTIONS} label="设置分区" width="narrow" align="center">
        <Outlet />
      </SectionLayout>
    </Page>
  )
}
