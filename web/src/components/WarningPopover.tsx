import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { AlertTriangle } from "lucide-react"
import type { RuntimeDependency } from "@/types"

interface WarningPopoverProps {
  missingDeps: RuntimeDependency[]
}

export function WarningPopover({ missingDeps }: WarningPopoverProps) {
  const [open, setOpen] = useState(false)

  if (missingDeps.length === 0) return null

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="inline-flex items-center justify-center text-amber-500 hover:text-amber-600 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-label="运行时依赖缺失警告"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <AlertTriangle className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup
            className="rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-[opacity,scale] duration-150 z-50 min-w-[280px] max-w-[380px]"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <Popover.Title className="font-medium text-sm mb-2">
              Runtime Dependencies
            </Popover.Title>
            <div className="space-y-1.5">
              {missingDeps.map((d) => (
                <div key={d.name} className="flex gap-2 items-start">
                  <AlertTriangle className="size-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">{d.name}</span>
                    <span className="text-muted-foreground"> 未安装：</span>
                    <span className="text-muted-foreground">{d.purpose}</span>
                  </div>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
