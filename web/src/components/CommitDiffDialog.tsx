import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Diff, Hunk, type RenderToken, type ViewType } from "react-diff-view"
import "react-diff-view/style/index.css"
import "highlight.js/styles/github.css"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  inferLanguage,
  tokenizeHunks,
  type HljsToken,
} from "@/lib/diff-highlight"
import {
  countFileChanges,
  decodeGitPath,
  getFileDisplayPath,
  hasRenderableDiff,
  isRenamed,
  listDiffFiles,
} from "@/lib/parse-unified-diff"
import type { FileData } from "react-diff-view"
import { Columns2, Rows2 } from "lucide-react"
import { useT } from "@/i18n"

export const DIFF_LOAD_FAILED_MARKER = "__DIFF_LOAD_FAILED__"

export interface CommitDiffDialogProps {
  open: boolean
  sha: string
  diff: string
  loading: boolean
  onClose: () => void
}

const renderHljsToken: RenderToken = (token, defaultRender, index) => {
  const t = token as HljsToken
  if (t.className?.startsWith("hljs-")) {
    const content =
      t.value ??
      (t.children?.map((child, i) => renderHljsToken(child, defaultRender, i)))
    return (
      <span key={index} className={t.className}>
        {content}
      </span>
    )
  }
  return defaultRender(token, index)
}

function FileListItem({
  file,
  selected,
  onSelect,
}: {
  file: FileData
  selected: boolean
  onSelect: () => void
}) {
  const path = getFileDisplayPath(file)
  const renamed = isRenamed(file)
  const { additions, deletions } = countFileChanges(file)

  return (
    <button
      type="button"
      onClick={onSelect}
      title={renamed ? `${file.oldPath} → ${file.newPath}` : path}
      className={cn(
        "w-full text-left px-3 py-2 border-b border-border/60 transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <div className="text-xs font-mono truncate">{path}</div>
      {renamed && (
        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
          {decodeGitPath(file.oldPath)} → {decodeGitPath(file.newPath)}
        </div>
      )}
      <div className="flex gap-1 mt-1">
        {additions > 0 && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400"
          >
            +{additions}
          </Badge>
        )}
        {deletions > 0 && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400"
          >
            −{deletions}
          </Badge>
        )}
      </div>
    </button>
  )
}

function RawDiffFallback({ diff }: { diff: string }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 p-4 min-h-0 flex-1 overflow-y-auto">
      <p className="text-sm text-muted-foreground">
        {t("diff.unable_parse")}
      </p>
      <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/50 p-3 rounded">
        {diff}
      </pre>
    </div>
  )
}

function DiffFileView({
  file,
  viewType,
}: {
  file: FileData
  viewType: ViewType
}) {
  const t = useT()
  const path = getFileDisplayPath(file)
  const language = inferLanguage(path)

  const tokens = useMemo(
    () => tokenizeHunks(file.hunks, language),
    [file.hunks, language],
  )

  if (file.isBinary) {
    return (
      <p className="text-sm text-muted-foreground p-4">{t("diff.binary")}</p>
    )
  }

  if (file.hunks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">{t("diff.no_hunks")}</p>
    )
  }

  return (
    <div className="commit-diff-view text-sm p-2">
      <Diff
        viewType={viewType}
        diffType={file.type}
        hunks={file.hunks}
        tokens={tokens}
        renderToken={tokens ? renderHljsToken : undefined}
        className="diff-viewer-table"
      >
        {(hunks) =>
          hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
        }
      </Diff>
    </div>
  )
}

function DiffContentBody({
  files,
  selectedIndex,
  onSelectFile,
  viewType,
}: {
  files: FileData[]
  selectedIndex: number
  onSelectFile: (index: number) => void
  viewType: ViewType
}) {
  const t = useT()
  const selectedFile = files[selectedIndex] ?? null

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r min-h-0">
        <div className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
          {t("diff.file_count", { count: files.length })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {files.map((file, i) => (
            <FileListItem
              key={`${file.oldPath}-${file.newPath}-${i}`}
              file={file}
              selected={i === selectedIndex}
              onSelect={() => onSelectFile(i)}
            />
          ))}
        </div>
      </aside>
      <main className="min-h-[280px] min-w-0 flex-1 overflow-y-auto">
        {selectedFile ? (
          <DiffFileView file={selectedFile} viewType={viewType} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("diff.select_file")}</p>
        )}
      </main>
    </div>
  )
}

export function CommitDiffDialog({
  open,
  sha,
  diff,
  loading,
  onClose,
}: CommitDiffDialogProps) {
  const t = useT()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [viewType, setViewType] = useState<ViewType>("unified")

  const files = useMemo(() => (loading ? [] : listDiffFiles(diff)), [diff, loading])
  const canRenderDiff = hasRenderableDiff(files)
  const showRawFallback =
    !loading &&
    diff.trim() !== "" &&
    !diff.startsWith(DIFF_LOAD_FAILED_MARKER) &&
    !canRenderDiff

  useEffect(() => {
    setSelectedIndex(0)
  }, [diff, sha])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  let body: ReactNode
  if (loading) {
    body = (
      <p className="text-muted-foreground text-sm p-4">{t("diff.loading")}</p>
    )
  } else if (diff === DIFF_LOAD_FAILED_MARKER) {
    body = (
      <p className="text-red-600 dark:text-red-400 text-sm p-4">
        {t("timeline.diff_load_failed")}
      </p>
    )
  } else if (diff.trim() === "") {
    body = (
      <p className="text-muted-foreground text-sm p-4">{t("diff.empty")}</p>
    )
  } else if (showRawFallback) {
    body = <RawDiffFallback diff={diff} />
  } else {
    body = (
      <DiffContentBody
        files={files}
        selectedIndex={selectedIndex}
        onSelectFile={setSelectedIndex}
        viewType={viewType}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-lg shadow-lg flex h-[85vh] max-h-[85vh] w-[min(90vw,72rem)] max-w-6xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 p-4 border-b shrink-0">
          <h2 className="font-semibold text-sm truncate">
            {t("diff.title", { sha })}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant={viewType === "unified" ? "secondary" : "ghost"}
              className="h-7 text-xs"
              onClick={() => setViewType("unified")}
              disabled={loading || !canRenderDiff}
            >
              <Rows2 className="size-3.5 mr-1" />
              {t("diff.unified")}
            </Button>
            <Button
              size="sm"
              variant={viewType === "split" ? "secondary" : "ghost"}
              className="h-7 text-xs"
              onClick={() => setViewType("split")}
              disabled={loading || !canRenderDiff}
            >
              <Columns2 className="size-3.5 mr-1" />
              {t("diff.split")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("diff.close")}>
              ✕
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {body}
        </div>
      </div>
    </div>
  )
}
