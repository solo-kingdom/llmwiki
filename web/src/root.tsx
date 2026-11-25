import * as React from "react"
import { Outlet } from "react-router"
import {
  BookOpenIcon,
  CircleHelpIcon,
  HistoryIcon,
  ListChecksIcon,
  MessageSquareIcon,
  NetworkIcon,
  ScrollTextIcon,
  SettingsIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react"
import { AppShell, type NavGroup } from "@/components/blocks/app-shell"
import { ThemeMenu } from "@/components/blocks/theme-menu"

function tinted(Icon: LucideIcon, tone: string): LucideIcon {
  const TintedIcon = React.forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => (
    <Icon ref={ref} {...props} className={className ? `${className} ${tone}` : tone} />
  ))
  TintedIcon.displayName = `Tinted(${Icon.displayName ?? Icon.name ?? "Icon"})`
  return TintedIcon
}

const nav: NavGroup[] = [
  {
    label: "知识库",
    items: [
      { label: "Wiki", to: "/wiki", icon: tinted(BookOpenIcon, "llmwiki-tone-indigo") },
      { label: "图谱", to: "/wiki/graph", icon: tinted(NetworkIcon, "llmwiki-tone-violet") },
    ],
  },
  {
    label: "工作台",
    items: [
      { label: "对话", to: "/", icon: tinted(MessageSquareIcon, "llmwiki-tone-sky") },
      { label: "任务", to: "/jobs", icon: tinted(ListChecksIcon, "llmwiki-tone-emerald") },
      { label: "时间线", to: "/timeline", icon: tinted(HistoryIcon, "llmwiki-tone-amber") },
      { label: "日志", to: "/logs", icon: tinted(ScrollTextIcon, "llmwiki-tone-cyan") },
    ],
  },
  {
    label: "系统",
    items: [
      { label: "设置", to: "/settings", icon: tinted(SettingsIcon, "llmwiki-tone-slate") },
      { label: "帮助", to: "/help", icon: tinted(CircleHelpIcon, "llmwiki-tone-rose") },
    ],
  },
]

function Brand() {
  // Brand is an identity asset, not a layout surface: the logo needs its own radius and the
  // collapsible-icon state needs raw group-data classes, so the layout-class rule is waived here.
  /* eslint-disable ui-template/no-layout-classes */
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <img src="/icon.png" alt="" width={20} height={20} className="size-5 shrink-0 rounded-[5px] object-contain" draggable={false} />
      <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold">知林</span>
        <span className="truncate text-xs text-muted-foreground">知识库工作台</span>
      </div>
    </div>
  )
  /* eslint-enable ui-template/no-layout-classes */
}

export function Root() {
  return <AppShell brand={<Brand />} nav={nav} footer={<ThemeMenu />}><Outlet /></AppShell>
}
