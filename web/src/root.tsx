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
} from "lucide-react"
import { AppShell, type NavGroup } from "@/components/blocks/app-shell"
import { ThemeMenu } from "@/components/blocks/theme-menu"

const nav: NavGroup[] = [
  {
    label: "工作台",
    items: [
      { label: "对话", to: "/", icon: MessageSquareIcon },
      { label: "任务", to: "/jobs", icon: ListChecksIcon },
      { label: "时间线", to: "/timeline", icon: HistoryIcon },
      { label: "日志", to: "/logs", icon: ScrollTextIcon },
    ],
  },
  {
    label: "知识库",
    items: [
      { label: "Wiki", to: "/wiki", icon: BookOpenIcon },
      { label: "图谱", to: "/wiki/graph", icon: NetworkIcon },
    ],
  },
  {
    label: "系统",
    items: [
      { label: "设置", to: "/settings", icon: SettingsIcon },
      { label: "帮助", to: "/help", icon: CircleHelpIcon },
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
