/** ThemeMenu — light / dark / system switch for the AppShell sidebar footer (collapses to its icon). */
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme, type ThemePreference } from "@/components/blocks/theme"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

export type ThemeMenuLabels = { title: string; light: string; dark: string; system: string }
const DEFAULT_LABELS: ThemeMenuLabels = { title: "主题", light: "浅色", dark: "深色", system: "跟随系统" }
const isPreference = (value: string): value is ThemePreference => value === "light" || value === "dark" || value === "system"

export function ThemeMenu({ labels = DEFAULT_LABELS }: { labels?: ThemeMenuLabels | undefined }) {
  const { preference, resolved, setPreference } = useTheme()
  const Icon = resolved === "dark" ? Moon : Sun
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton tooltip={labels.title}><Icon /><span>{labels.title}</span></SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuRadioGroup value={preference} onValueChange={(value) => { if (isPreference(value)) setPreference(value) }}>
              <DropdownMenuRadioItem value="light"><Sun />{labels.light}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon />{labels.dark}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Monitor />{labels.system}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
