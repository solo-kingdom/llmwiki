import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxIcon, ListChecksIcon, SettingsIcon } from "lucide-react"
import { MemoryRouter } from "react-router"
import { AppShell, ShellBrand, type NavGroup } from "@/components/blocks/app-shell"
import { SettingsPage, type SettingsGroup } from "@/components/page-templates/settings-page"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const meta = {
  title: "ui-kit/Pages/Settings",
  tags: ["fidelity"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const nav: NavGroup[] = [
  { items: [{ label: "Inbox", to: "/inbox", icon: InboxIcon }, { label: "Issues", to: "/issues", icon: ListChecksIcon }] },
  { label: "Workspace", items: [{ label: "Settings", to: "/settings", icon: SettingsIcon }] },
]

const groups: SettingsGroup[] = [
  {
    title: "Interface",
    rows: [
      {
        id: "theme", label: "Theme", description: "Follow the system or pick one", controlId: "theme",
        control: (
          <Select defaultValue="system">
            <SelectTrigger id="theme" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      { id: "compact", label: "Compact lists", description: "Show more rows per screen", controlId: "compact", control: <Switch id="compact" defaultChecked /> },
    ],
  },
  {
    title: "Notifications",
    rows: [
      { id: "mentions", label: "Mentions", controlId: "mentions", control: <Switch id="mentions" defaultChecked /> },
      { id: "digest", label: "Weekly digest", description: "A summary every Monday", controlId: "digest", control: <Switch id="digest" /> },
    ],
  },
]

export const InShell: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/settings"]}>
      <AppShell brand={<ShellBrand title="Workspace" />} nav={nav}>
        <SettingsPage title="Preferences" groups={groups} />
      </AppShell>
    </MemoryRouter>
  ),
}
