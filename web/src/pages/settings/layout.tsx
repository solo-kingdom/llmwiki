import { CpuIcon, DatabaseIcon, KeyRoundIcon, PlugIcon, ScrollTextIcon } from "lucide-react"
import { Outlet } from "react-router"
import { SectionLayout, type SectionNavItem } from "@/components/blocks/section-nav"
import { ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Page } from "@/components/blocks/surfaces"
import { useApp } from "@/context/app-context"

/** One route per section; `/settings` redirects to the first (see main.tsx). */
export const SETTINGS_SECTIONS: SectionNavItem[] = [
  { label: "模型", to: "/settings/models", icon: <CpuIcon /> },
  { label: "摄入与检索", to: "/settings/ingest", icon: <DatabaseIcon /> },
  { label: "访问控制", to: "/settings/access", icon: <KeyRoundIcon /> },
  { label: "外部集成", to: "/settings/integrations", icon: <PlugIcon /> },
  { label: "规则文件", to: "/settings/rules", icon: <ScrollTextIcon /> },
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
