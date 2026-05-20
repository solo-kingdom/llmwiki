import { useCallback, useRef, useState } from "react"
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react"
import { useApp } from "@/context/AppContext"
import { PageContainer } from "@/components/PageContainer"
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

export function IngestRaw() {
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
            filename: "(批量上传)",
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
    <PageContainer>
      <div
        className="flex w-full flex-col gap-6"
        data-testid="ingest-raw-page"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">原始数据直投</h1>
          <p className="text-sm text-muted-foreground">
            已有成型材料时使用 Ingest：上传文件或粘贴文本块，一键提交归档。
            需要与模型多轮探索时，请使用{" "}
            <button
              type="button"
              className="text-point underline-offset-2 hover:underline"
              onClick={() => navigateTo(workbenchViewHref("chat"))}
            >
              Chat
            </button>
            。
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">文件</h2>
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
            data-testid="ingest-raw-file-dropzone"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                拖放文件到此处，或点击按钮选择多个文件
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                选择文件
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="ingest-raw-file-input"
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
              data-testid="ingest-raw-file-list"
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
                    aria-label={`移除 ${file.name}`}
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
            <h2 className="text-sm font-medium">文本块</h2>
            <Button type="button" variant="outline" size="sm" onClick={addTextBlock}>
              <Plus className="size-3.5" />
              新增文本块
            </Button>
          </div>

          <div className="space-y-3">
            {textBlocks.map((block, index) => (
              <div
                key={block.id}
                className="space-y-2 rounded-xl border bg-card/50 p-4"
                data-testid={`ingest-raw-text-block-${index}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Input
                    placeholder="块标题（可选）"
                    value={block.title}
                    onChange={(e) =>
                      updateTextBlock(block.id, { title: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={textBlocks.length === 1 && !block.title && !block.content}
                    aria-label="删除文本块"
                    onClick={() => removeTextBlock(block.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  placeholder="正文（必填，至少一个非空文本块才能提交）"
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
          <h2 className="text-sm font-medium">批次信息（可选）</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="批次标题"
              value={batchTitle}
              onChange={(e) => setBatchTitle(e.target.value)}
            />
            <Input
              placeholder="来源"
              value={batchSource}
              onChange={(e) => setBatchSource(e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!canSubmit || submitBusy}
              onClick={() => void handleSubmit()}
              data-testid="ingest-raw-submit"
            >
              {submitBusy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  提交中...
                </>
              ) : (
                "直接归档"
              )}
            </Button>
            {!canSubmit && !submitBusy && (
              <span className="text-xs text-muted-foreground">
                请至少添加一个文件或填写一个非空文本块
              </span>
            )}
          </div>

          {submitSummary && (
            <div
              className="space-y-2 rounded-lg bg-muted px-3 py-2 text-sm"
              data-testid="ingest-raw-submit-summary"
            >
              {totalAccepted > 0 && (
                <p className="text-green-700 dark:text-green-400">
                  成功 {totalAccepted} 个任务
                  {submitSummary.textJobId && (
                    <span>（文本 job: {submitSummary.textJobId}）</span>
                  )}
                  {submitSummary.accepted.length > 0 && (
                    <span>
                      {" "}
                      文件 job:{" "}
                      {submitSummary.accepted.map((a) => a.job_id).join(", ")}
                    </span>
                  )}
                </p>
              )}
              {totalRejected > 0 && (
                <p className="text-red-700 dark:text-red-400">
                  失败 {totalRejected} 项：
                  {submitSummary.textError && ` 文本 - ${submitSummary.textError};`}
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
                查看 Jobs
              </Button>
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  )
}
