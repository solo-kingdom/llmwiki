import { useState } from "react"
import { List } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { DocumentViewer } from "@/components/DocumentViewer"
import { DocumentOutline } from "@/components/DocumentOutline"
import { Button } from "@/components/ui/button"
import { Dialog } from "@base-ui/react/dialog"
import type { OutlineItem } from "@/types"

export function WikiPage() {
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <DocumentViewer onOutlineChange={setOutline} />
      <aside className="hidden w-64 shrink-0 lg:block">
        <DocumentOutline items={outline} className="h-full" />
      </aside>
      <div className="absolute bottom-4 right-4 z-10 lg:hidden">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-md"
          onClick={() => setMobileOutlineOpen(true)}
          disabled={outline.length === 0}
        >
          <List className="size-3.5" />
          大纲
        </Button>
      </div>
      <Dialog.Root open={mobileOutlineOpen} onOpenChange={setMobileOutlineOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l bg-background shadow-lg lg:hidden">
            <DocumentOutline items={outline} className="h-full border-l-0" />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
