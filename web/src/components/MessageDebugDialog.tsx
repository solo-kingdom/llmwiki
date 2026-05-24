import { useCallback, useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X, Loader2 } from "lucide-react"
import { getSessionMessageEvents } from "@/lib/api"
import { useT } from "@/i18n"
import type { IngestSessionMessage, SessionMessageEvent } from "@/types"

interface MessageDebugDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string | null
  message: IngestSessionMessage | null
}

function formatPayload(payload: string): string {
  if (!payload) return ""
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed === "string") return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return payload
  }
}

export function MessageDebugDialog({
  open,
  onOpenChange,
  sessionId,
  message,
}: MessageDebugDialogProps) {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionMessageEvent[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!sessionId || !message?.id) return
    setLoading(true)
    setError(null)
    try {
      const res = await getSessionMessageEvents(sessionId, message.id)
      setEvents(res.events)
      if (res.events.length > 0) {
        setSelectedId((prev) => {
          if (prev != null && res.events.some((e) => e.id === prev)) return prev
          return res.events[res.events.length - 1].id
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.load_failed"))
    } finally {
      setLoading(false)
    }
  }, [sessionId, message?.id])

  useEffect(() => {
    if (!open || !sessionId || !message?.id) {
      setEvents([])
      setSelectedId(null)
      setError(null)
      return
    }
    void load()
  }, [open, sessionId, message?.id, load])

  const selected = events.find((e) => e.id === selectedId) ?? null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="text-base font-semibold truncate pr-2">
              {t("chat.debug_title")}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {loading && events.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading_ellipsis")}
            </div>
          )}

          {error && (
            <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="px-4 py-8 text-sm text-center text-muted-foreground">
              {t("chat.no_debug_events")}
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
                      {formatPayload(selected.payload) || t("common.no_details")}
                    </pre>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">{t("jobs.select_event")}</p>
                )}
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
