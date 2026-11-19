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
import { AppShell, ShellBrand, type NavGroup } from "@/components/blocks/app-shell"
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

export function Root() {
  return <AppShell brand={<ShellBrand title="LLM Wiki" subtitle="知识库工作台" />} nav={nav} footer={<ThemeMenu />}><Outlet /></AppShell>
}
