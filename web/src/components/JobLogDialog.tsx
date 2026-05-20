import { useCallback, useEffect, useMemo, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X, Loader2 } from "lucide-react"
import { getIngestJobEvents } from "@/lib/api"
import type { IngestJob, IngestJobEvent } from "@/types"

interface JobLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: IngestJob | null
}

function parsePayload(payload: string): unknown {
  if (!payload) return null
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return payload
  }
}

function formatPayload(payload: string): string {
  const parsed = parsePayload(payload)
  if (parsed === null) return ""
  if (typeof parsed === "string") return parsed
  return JSON.stringify(parsed, null, 2)
}

export function JobLogDialog({ open, onOpenChange, job }: JobLogDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<IngestJobEvent[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!job?.id) return
    setLoading(true)
    setError(null)
    try {
      const res = await getIngestJobEvents(job.id)
      setEvents(res.events)
      if (res.events.length > 0) {
        setSelectedId((prev) => {
          if (prev != null && res.events.some((e) => e.id === prev)) return prev
          return res.events[res.events.length - 1].id
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [job?.id])

  useEffect(() => {
    if (!open || !job?.id) {
      setEvents([])
      setSelectedId(null)
      setError(null)
      return
    }
    void load()
  }, [open, job?.id, load])

  useEffect(() => {
    if (!open || job?.status !== "running") return
    const t = setInterval(() => void load(), 2000)
    return () => clearInterval(t)
  }, [open, job?.status, load])

  const hasStaleRecovered = useMemo(
    () => events.some((e) => e.phase === "stale_recovered"),
    [events],
  )

  const selected = events.find((e) => e.id === selectedId) ?? null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-base font-semibold truncate pr-2">
              执行日志{job ? ` · ${job.source_path}` : ""}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {hasStaleRecovered && (
            <p className="mx-4 mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/40 rounded-md px-3 py-2">
              任务曾因心跳超时或服务重启被重新入队，失败信息已清空。
            </p>
          )}

          {loading && events.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          )}

          {error && (
            <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="px-4 py-8 text-sm text-center text-muted-foreground">
              暂无执行记录
            </p>
          )}

          {events.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              <ul className="sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto max-h-48 sm:max-h-none">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(ev.id)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/60 ${
                        selectedId === ev.id ? "bg-muted" : ""
                      }`}
                    >
                      <span className="font-medium text-foreground">
                        {ev.step}
                      </span>
                      <span className="text-muted-foreground"> / {ev.phase}</span>
                      <br />
                      <span className="text-muted-foreground">
                        {new Date(ev.created_at).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
                {selected ? (
                  <div className="space-y-2 text-sm">
                    {selected.message && (
                      <p className="text-muted-foreground">{selected.message}</p>
                    )}
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs font-mono overflow-x-auto">
                      {formatPayload(selected.payload) || "(无详情)"}
                    </pre>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">选择一条事件查看详情</p>
                )}
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
