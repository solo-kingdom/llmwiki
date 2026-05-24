import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Loader2, Plus, Trash2, X } from "lucide-react"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { composeTextBlocksToMarkdown } from "@/lib/compose-text-blocks"

interface TextBlockRow {
  id: string
  title: string
  content: string
}

function newBlockId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyBlock(): TextBlockRow {
  return { id: newBlockId(), title: "", content: "" }
}

export function ContextInputDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const { appendContextMessage, showToast } = useApp()

  const [textBlocks, setTextBlocks] = useState<TextBlockRow[]>([createEmptyBlock()])
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const hasNonEmptyText = textBlocks.some((b) => b.content.trim())

  const resetForm = () => {
    setTextBlocks([createEmptyBlock()])
    setSubmitError(null)
  }

  const addTextBlock = () => {
    setTextBlocks((prev) => [...prev, createEmptyBlock()])
  }

  const removeTextBlock = (id: string) => {
    setTextBlocks((prev) => {
      const next = prev.filter((b) => b.id !== id)
      return next.length > 0 ? next : [createEmptyBlock()]
    })
  }

  const updateTextBlock = (
    id: string,
    patch: Partial<Pick<TextBlockRow, "title" | "content">>,
  ) => {
    setTextBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    )
  }

  const handleSubmit = async () => {
    if (!hasNonEmptyText || submitBusy) return

    setSubmitBusy(true)
    setSubmitError(null)

    try {
      const content = composeTextBlocksToMarkdown(textBlocks)
      await appendContextMessage(content)
      resetForm()
      onOpenChange(false)
      showToast(t("chat.context.added"))
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitBusy) resetForm()
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup
          className="fixed inset-y-4 right-4 z-50 flex w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0 data-[ending-style]:translate-x-4 data-[ending-style]:opacity-0 transition-[opacity,translate] duration-200 sm:left-1/2 sm:right-auto sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2"
          data-testid="context-input-dialog"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-base font-semibold">
              {t("chat.context.title")}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-4 text-sm text-muted-foreground">
              {t("chat.context.desc")}
            </p>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">{t("chat.context.text_blocks")}</h2>
                <Button type="button" variant="outline" size="sm" onClick={addTextBlock}>
                  <Plus className="size-3.5" />
                  {t("chat.context.add_block")}
                </Button>
              </div>

              <div className="space-y-3">
                {textBlocks.map((block, index) => (
                  <div
                    key={block.id}
                    className="space-y-2 rounded-xl border bg-card/50 p-4"
                    data-testid={`context-text-block-${index}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        placeholder={t("chat.context.block_title_optional")}
                        value={block.title}
                        onChange={(e) =>
                          updateTextBlock(block.id, { title: e.target.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={
                          textBlocks.length === 1 && !block.title && !block.content
                        }
                        aria-label={t("chat.context.delete_block")}
                        onClick={() => removeTextBlock(block.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <textarea
                      className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      placeholder={t("chat.context.block_content_required")}
                      value={block.content}
                      onChange={(e) =>
                        updateTextBlock(block.id, { content: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-3 border-t px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={!hasNonEmptyText || submitBusy}
                onClick={() => void handleSubmit()}
                data-testid="context-input-submit"
              >
                {submitBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("common.submitting")}
                  </>
                ) : (
                  t("chat.context.submit")
                )}
              </Button>
              {!hasNonEmptyText && !submitBusy && (
                <span className="text-xs text-muted-foreground">
                  {t("chat.context.submit_hint")}
                </span>
              )}
            </div>

            {submitError && (
              <p className="text-sm text-destructive" data-testid="context-input-error">
                {submitError}
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
