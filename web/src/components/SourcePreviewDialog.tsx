import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X, Loader2 } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { getSourceContent, getSourceUrl } from "@/lib/api"

const previewableTextExts = new Set([".md", ".txt"])
const previewableImageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"])

function getExt(path: string): string {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return ""
  return path.slice(dot).toLowerCase()
}

export function isPreviewable(sourcePath: string): boolean {
  const ext = getExt(sourcePath)
  return previewableTextExts.has(ext) || previewableImageExts.has(ext)
}

function isImageSource(sourcePath: string): boolean {
  return previewableImageExts.has(getExt(sourcePath))
}

interface SourcePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string | null
  sourcePath: string
}

export function SourcePreviewDialog({
  open,
  onOpenChange,
  jobId,
  sourcePath,
}: SourcePreviewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)

  const isImage = jobId ? isImageSource(sourcePath) : false

  useEffect(() => {
    if (!open || !jobId) {
      setTextContent(null)
      setError(null)
      return
    }

    if (isImage) {
      // For images, we use the URL directly in <img src> — no fetch needed
      setTextContent(null)
      setError(null)
      return
    }

    // For text files, fetch content via API
    setLoading(true)
    setError(null)
    setTextContent(null)

    getSourceContent(jobId)
      .then((resp) => {
        setTextContent(resp.content)
      })
      .catch((err) => {
        setError(err.message || "Failed to load source file")
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, jobId, isImage])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-3xl max-h-[80vh] rounded-xl border bg-background p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-[opacity,scale] duration-200 flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <Dialog.Title className="text-base font-semibold truncate">
              {sourcePath.split("/").pop() || "Source Preview"}
            </Dialog.Title>
            <Dialog.Close className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto flex-1 min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
              </div>
            )}

            {error && (
              <div className="py-8 text-center text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {!loading && !error && isImage && jobId && (
              <div className="flex items-center justify-center">
                <img
                  src={getSourceUrl(jobId)}
                  alt={sourcePath}
                  className="max-w-full max-h-[65vh] object-contain"
                />
              </div>
            )}

            {!loading && !error && textContent !== null && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {textContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
