import { useCallback, useRef, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { composeTextBlocksToMarkdown } from "@/lib/compose-text-blocks"
import { navigateTo, workbenchViewHref } from "@/lib/wiki-routes"

interface TextBlockRow {
  id: string
  title: string
  content: string
}

interface SubmitSummary {
  textJobId?: string
  textError?: string
  accepted: { filename: string; job_id: string }[]
  rejected: { filename: string; message: string }[]
}

function newBlockId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyBlock(): TextBlockRow {
  return { id: newBlockId(), title: "", content: "" }
}

export function DirectIngestPanel({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const { submitText, submitUpload, refreshIngestJobs } = useApp()

  const [textBlocks, setTextBlocks] = useState<TextBlockRow[]>([createEmptyBlock()])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [batchTitle, setBatchTitle] = useState("")
  const [batchSource, setBatchSource] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitSummary, setSubmitSummary] = useState<SubmitSummary | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasNonEmptyText = textBlocks.some((b) => b.content.trim())
  const canSubmit = hasNonEmptyText || selectedFiles.length > 0

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

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    setSelectedFiles((prev) => {
      const names = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const file of files) {
        const key = `${file.name}:${file.size}`
        if (!names.has(key)) {
          names.add(key)
          merged.push(file)
        }
      }
      return merged
    })
    setSubmitSummary(null)
  }, [])

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!canSubmit || submitBusy) return

    setSubmitBusy(true)
    setSubmitSummary(null)

    const summary: SubmitSummary = { accepted: [], rejected: [] }
    const sourceRef = batchSource.trim() || undefined
    const title = batchTitle.trim() || undefined

    try {
      if (hasNonEmptyText) {
        const content = composeTextBlocksToMarkdown(textBlocks)
        try {
          const result = await submitText({
            content,
            title,
            source_ref: sourceRef,
          })
          summary.textJobId = result.job.id
        } catch (e) {
          summary.textError = (e as Error).message
        }
      }

      if (selectedFiles.length > 0) {
        try {
          const uploadResult = await submitUpload(selectedFiles, sourceRef)
          summary.accepted.push(
            ...uploadResult.accepted.map((item) => ({
              filename: item.filename,
              job_id: item.job_id,
            })),
          )
          summary.rejected.push(
            ...uploadResult.rejected.map((item) => ({
              filename: item.filename,
              message: item.message,
            })),
          )
        } catch (e) {
          summary.rejected.push({
            filename: t("ingest.direct.batch_upload"),
            message: (e as Error).message,
          })
        }
      }

      await refreshIngestJobs()
      setSubmitSummary(summary)

      const allSucceeded =
        !summary.textError &&
        summary.rejected.length === 0 &&
        (summary.textJobId !== undefined || summary.accepted.length > 0)

      if (allSucceeded) {
        setTextBlocks([createEmptyBlock()])
        setSelectedFiles([])
        setBatchTitle("")
        setBatchSource("")
      }
    } finally {
      setSubmitBusy(false)
    }
  }

  const totalAccepted =
    (submitSummary?.textJobId ? 1 : 0) + (submitSummary?.accepted.length ?? 0)
  const totalRejected =
    (submitSummary?.textError ? 1 : 0) + (submitSummary?.rejected.length ?? 0)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup
          className="fixed inset-y-4 right-4 z-50 flex w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0 data-[ending-style]:translate-x-4 data-[ending-style]:opacity-0 transition-[opacity,translate] duration-200 sm:left-1/2 sm:right-auto sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2"
          data-testid="direct-ingest-panel"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-base font-semibold">
              {t("ingest.direct.title")}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-4 text-sm text-muted-foreground">
              {t("ingest.direct.desc")}
            </p>

            <div className="flex flex-col gap-6">
              <section className="space-y-3">
                <h2 className="text-sm font-medium">{t("ingest.direct.files")}</h2>
                <div
                  className={`rounded-xl border border-dashed p-6 transition-colors ${
                    isDragging
                      ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20"
                      : "border-border bg-card/40"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    addFiles(Array.from(e.dataTransfer.files))
                  }}
                  data-testid="direct-ingest-file-dropzone"
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-muted-foreground">
                      {t("ingest.direct.file_drop_hint")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-3.5" />
                      {t("ingest.direct.select_files")}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      data-testid="direct-ingest-file-input"
                      onChange={(e) => {
                        addFiles(Array.from(e.target.files ?? []))
                        e.target.value = ""
                      }}
                    />
                  </div>
                </div>

                {selectedFiles.length > 0 && (
                  <ul
                    className="space-y-2 rounded-lg border bg-card/50 p-3"
                    data-testid="direct-ingest-file-list"
                  >
                    {selectedFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center rounded p-1 text-muted-foreground hover:text-foreground"
                          aria-label={t("ingest.direct.remove_file", {
                            name: file.name,
                          })}
                          onClick={() => removeFile(index)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {t("ingest.direct.text_blocks")}
                  </h2>
                  <Button type="button" variant="outline" size="sm" onClick={addTextBlock}>
                    <Plus className="size-3.5" />
                    {t("ingest.direct.add_block")}
                  </Button>
                </div>

                <div className="space-y-3">
                  {textBlocks.map((block, index) => (
                    <div
                      key={block.id}
                      className="space-y-2 rounded-xl border bg-card/50 p-4"
                      data-testid={`direct-ingest-text-block-${index}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Input
                          placeholder={t("ingest.direct.block_title_optional")}
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
                          aria-label={t("ingest.direct.delete_block")}
                          onClick={() => removeTextBlock(block.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <textarea
                        className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        placeholder={t("ingest.direct.block_content_required")}
                        value={block.content}
                        onChange={(e) =>
                          updateTextBlock(block.id, { content: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-medium">{t("ingest.direct.batch_info")}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder={t("ingest.direct.batch_title")}
                    value={batchTitle}
                    onChange={(e) => setBatchTitle(e.target.value)}
                  />
                  <Input
                    placeholder={t("ingest.direct.source")}
                    value={batchSource}
                    onChange={(e) => setBatchSource(e.target.value)}
                  />
                </div>
              </section>
            </div>
          </div>

          <div className="space-y-3 border-t px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={!canSubmit || submitBusy}
                onClick={() => void handleSubmit()}
                data-testid="direct-ingest-submit"
              >
                {submitBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("common.submitting")}
                  </>
                ) : (
                  t("ingest.direct.submit")
                )}
              </Button>
              {!canSubmit && !submitBusy && (
                <span className="text-xs text-muted-foreground">
                  {t("ingest.direct.submit_hint")}
                </span>
              )}
            </div>

            {submitSummary && (
              <div
                className="space-y-2 rounded-lg bg-muted px-3 py-2 text-sm"
                data-testid="direct-ingest-submit-summary"
              >
                {totalAccepted > 0 && (
                  <p className="text-green-700 dark:text-green-400">
                    {t("ingest.direct.success_count", { count: totalAccepted })}
                    {submitSummary.textJobId && (
                      <span>
                        {t("ingest.direct.text_job", {
                          id: submitSummary.textJobId,
                        })}
                      </span>
                    )}
                    {submitSummary.accepted.length > 0 && (
                      <span>
                        {" "}
                        {t("ingest.direct.file_jobs", {
                          ids: submitSummary.accepted.map((a) => a.job_id).join(", "),
                        })}
                      </span>
                    )}
                  </p>
                )}
                {totalRejected > 0 && (
                  <p className="text-red-700 dark:text-red-400">
                    {t("ingest.direct.failed_count", { count: totalRejected })}
                    {submitSummary.textError &&
                      t("ingest.direct.failed_text", {
                        error: submitSummary.textError,
                      })}
                    {submitSummary.rejected
                      .map((r) => ` ${r.filename} - ${r.message}`)
                      .join(";")}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigateTo(workbenchViewHref("jobs"))}
                >
                  {t("ingest.direct.view_jobs")}
                </Button>
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
