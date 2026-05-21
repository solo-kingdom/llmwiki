import { useEffect, useRef, useState, useCallback } from "react"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PastePreview, analyzePaste } from "@/components/PastePreview"
import { TextIngestDialog } from "@/components/TextIngestDialog"
import { Upload, FileText, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import type { PasteInfo } from "@/components/PastePreview"

interface UploadResult {
  accepted: number
  rejected: number
  details: string
}

export function IngestHub() {
  const t = useT()
  const { submitConversation, submitText, submitUpload, refreshIngestJobs, loadCapabilities } =
    useApp()

  // Conversation input state
  const [convContent, setConvContent] = useState("")
  const [convTitle, setConvTitle] = useState("")
  const [convSource, setConvSource] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Paste preview state
  const [pasteInfo, setPasteInfo] = useState<PasteInfo | null>(null)

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)

  // Drag state
  const [isDragging, setIsDragging] = useState(false)

  // Text dialog state
  const [textDialogOpen, setTextDialogOpen] = useState(false)

  // Submit feedback state
  const [submitBusy, setSubmitBusy] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  // Auto-resize textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    refreshIngestJobs()
    loadCapabilities()
    const t = setInterval(() => {
      refreshIngestJobs()
    }, 3000)
    return () => clearInterval(t)
  }, [refreshIngestJobs, loadCapabilities])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.6)}px`
  }, [])

  const handleContentChange = (value: string) => {
    setConvContent(value)
    // Clear paste info on manual input
    setPasteInfo(null)
    // Adjust height on next frame
    requestAnimationFrame(adjustTextareaHeight)
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text")
    if (text) {
      const info = analyzePaste(text)
      setPasteInfo(info)
    }
  }, [])

  const handleSubmitConversation = async () => {
    if (!convContent.trim()) return
    setSubmitBusy(true)
    try {
      await submitConversation({
        content: convContent,
        title: convTitle || undefined,
        source_ref: convSource || undefined,
      })
      setConvContent("")
      setConvTitle("")
      setConvSource("")
      setPasteInfo(null)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 1500)
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    } finally {
      setSubmitBusy(false)
    }
  }

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return
    setUploadBusy(true)
    setUploadResult(null)
    try {
      const result = await submitUpload(files)
      setUploadResult({
        accepted: result.accepted.length,
        rejected: result.rejected.length,
        details: result.rejected
          .map((r) => `${r.filename}: ${r.message}`)
          .join("; "),
      })
    } finally {
      setUploadBusy(false)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        handleFileUpload(files)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const handleTextSubmit = async (payload: {
    title?: string
    content: string
    filename?: string
  }) => {
    await submitText(payload)
    await refreshIngestJobs()
  }

  const isEmpty = !convContent.trim()

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-3 min-h-full justify-center">
        {/* Paste preview bar */}
        <PastePreview info={pasteInfo} />

        {/* Main textarea area */}
        <div
          className={`relative rounded-xl border transition-colors ${
            isDragging
              ? "border-blue-400 border-dashed bg-blue-50/50"
              : "border-input bg-transparent"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Empty state placeholder */}
          {isEmpty && !isDragging && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-8 text-center">
              <p className="text-lg text-muted-foreground/60 mb-1">
                {t("ingest.paste_hint")}
              </p>
              <p className="text-xs text-muted-foreground/40">
                {t("ingest.paste_subhint")}
              </p>
            </div>
          )}

          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <p className="text-blue-600 font-medium">
                {t("ingest.drop_to_upload")}
              </p>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="w-full min-h-40 max-h-[60vh] rounded-xl bg-transparent px-4 py-3 text-sm outline-none resize-y placeholder-transparent"
            placeholder={t("ingest.input_placeholder")}
            value={convContent}
            onChange={(e) => handleContentChange(e.target.value)}
            onPaste={handlePaste}
          />
        </div>

        {/* Advanced options */}
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:underline"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {t("ingest.advanced")}
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Input
                placeholder={t("ingest.session_title_optional")}
                value={convTitle}
                onChange={(e) => setConvTitle(e.target.value)}
              />
              <Input
                placeholder={t("ingest.source_optional")}
                value={convSource}
                onChange={(e) => setConvSource(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2">
          <Button
            disabled={submitBusy || isEmpty}
            onClick={handleSubmitConversation}
          >
            {submitBusy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("common.submitting")}
              </>
            ) : (
              t("ingest.submit")
            )}
          </Button>

          {showSuccess && (
            <span className="text-xs text-green-600 font-medium animate-in fade-in duration-300">
              {t("ingest.submitted")}
            </span>
          )}

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            disabled={uploadBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {t("ingest.upload_files")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              handleFileUpload(files)
              // Reset input so same file can be re-selected
              e.target.value = ""
            }}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setTextDialogOpen(true)}
          >
            <FileText className="size-3.5" />
            {t("ingest.text")}
          </Button>
        </div>

        {/* Upload result inline */}
        {uploadResult && (
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <span className="text-green-600">
              {t("ingest.upload_accepted", { count: uploadResult.accepted })}
            </span>
            {uploadResult.rejected > 0 && (
              <>
                {" · "}
                <span className="text-red-600">
                  {t("ingest.upload_rejected", {
                    count: uploadResult.rejected,
                    details: uploadResult.details,
                  })}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Text ingest dialog */}
      <TextIngestDialog
        open={textDialogOpen}
        onOpenChange={setTextDialogOpen}
        onSubmit={handleTextSubmit}
      />
    </div>
  )
}
