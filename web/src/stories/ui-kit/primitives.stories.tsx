import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const meta = {
  title: "ui-kit/Primitives",
  tags: ["fidelity"],
  parameters: { layout: "padded" },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const variants = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const
const sizes = ["xs", "sm", "default", "lg"] as const

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-background p-4">
      {variants.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          {sizes.map((size) => <Button key={size} variant={variant} size={size}>{variant}</Button>)}
          <Button variant={variant} size="icon" aria-label="Add"><PlusIcon /></Button>
          <Button variant={variant} disabled>disabled</Button>
        </div>
      ))}
    </div>
  ),
}

export const Controls: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-background p-4">
      <Input aria-label="Name" placeholder="Placeholder" />
      <Input aria-label="Value" defaultValue="Filled value" />
      <Input aria-label="Disabled" defaultValue="Disabled" disabled />
      <Select defaultValue="system">
        <SelectTrigger aria-label="Theme" className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="system">System</SelectItem>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-4">
        <Switch aria-label="Off" />
        <Switch aria-label="On" defaultChecked />
        <Checkbox aria-label="Unchecked" />
        <Checkbox aria-label="Checked" defaultChecked />
      </div>
      <div className="flex items-center gap-2">
        {(["default", "secondary", "outline", "destructive"] as const).map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}
      </div>
    </div>
  ),
}
