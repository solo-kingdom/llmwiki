import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface TextIngestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: {
    title?: string
    content: string
    filename?: string
  }) => Promise<void>
}

export function TextIngestDialog({
  open,
  onOpenChange,
  onSubmit,
}: TextIngestDialogProps) {
  const [title, setTitle] = useState("")
  const [filename, setFilename] = useState("")
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim()) return
    setBusy(true)
    try {
      await onSubmit({
        title: title || undefined,
        content,
        filename: filename || undefined,
      })
      setTitle("")
      setFilename("")
      setContent("")
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xl rounded-xl border bg-background p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-[opacity,scale] duration-200">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-base font-semibold">
              文本摄入
            </Dialog.Title>
            <Dialog.Close className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  标题（可选）
                </label>
                <Input
                  placeholder="文本标题"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  文件名（可选）
                </label>
                <Input
                  placeholder="notes.md"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                内容
              </label>
              <textarea
                className="w-full min-h-48 max-h-[50vh] rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y"
                placeholder="粘贴或输入文本内容..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={handleClose} disabled={busy}>
              取消
            </Button>
            <Button
              disabled={busy || !content.trim()}
              onClick={handleSubmit}
            >
              {busy ? "提交中..." : "提交文本摄入"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
