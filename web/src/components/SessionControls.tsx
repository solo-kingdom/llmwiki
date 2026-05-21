import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { Button } from "@/components/ui/button"
import type { SessionListItem } from "@/types"
import {
  Plus,
  MessageSquare,
  Archive,
  List,
  Trash2,
  X,
} from "lucide-react"

function sessionLabel(title: string, untitled: string) {
  return title.trim() || untitled
}

export function SessionControls() {
  const t = useT()
  const {
    sessions,
    activeSessionId,
    sessionBusy,
    instances,
    settings,
    createSession,
    switchSession,
    deleteSession,
    listSessions,
    loadInstances,
    loadSettings,
  } = useApp()

  const [switchOpen, setSwitchOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void listSessions()
    void loadInstances()
    void loadSettings()
  }, [listSessions, loadInstances, loadSettings])

  const activeSessions = sessions.filter((s) => s.status === "active")
  const archivedSessions = sessions.filter((s) => s.status === "archived")

  const getInstanceName = (instanceId: string) => {
    const inst = instances.find((i) => i.id === instanceId)
    return inst?.name ?? instanceId
  }

  const handleNewChat = async () => {
    const instanceId = settings?.last_instance_id
    const model = settings?.last_model
    await createSession(instanceId, model)
  }

  const handleSwitch = async (id: string) => {
    await switchSession(id)
    setSwitchOpen(false)
  }

  const handleDeleteClick = (
    e: React.MouseEvent,
    session: SessionListItem,
  ) => {
    e.stopPropagation()
    setDeleteTarget(session)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteSession(deleteTarget.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const deletePrompt = deleteTarget
    ? deleteTarget.status === "archived"
      ? t("session.delete_confirm_archived", {
          title: sessionLabel(deleteTarget.title, t("common.untitled")),
        })
      : t("session.delete_confirm_active", {
          title: sessionLabel(deleteTarget.title, t("common.untitled")),
        })
    : ""

  const renderSessionRow = (s: SessionListItem, archived = false) => {
    const isActive = s.id === activeSessionId
    const content = (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate">
            {sessionLabel(s.title, t("common.untitled"))}
          </span>
        </div>
        {(s.llm_instance_id || s.llm_model) && (
          <p className="mt-1 truncate pl-5.5 text-xs text-muted-foreground">
            {getInstanceName(s.llm_instance_id)}
            {s.llm_model ? ` / ${s.llm_model}` : ""}
          </p>
        )}
      </>
    )

    if (archived) {
      return (
        <div
          key={s.id}
          className="flex items-start gap-1 rounded-lg px-1 py-1 text-sm opacity-60"
        >
          <div className="min-w-0 flex-1 px-2 py-1">{content}</div>
          <Button
            size="sm"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            title={t("session.delete_title")}
            disabled={sessionBusy || deleting}
            onClick={(e) => handleDeleteClick(e, s)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )
    }

    return (
      <div
        key={s.id}
        className={`flex items-start gap-1 rounded-lg transition-colors ${
          isActive ? "bg-primary/10" : "hover:bg-muted"
        }`}
      >
        <button
          type="button"
          onClick={() => void handleSwitch(s.id)}
          className={`min-w-0 flex-1 px-3 py-2 text-left text-sm ${
            isActive ? "font-medium text-primary" : ""
          }`}
        >
          {content}
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 size-8 shrink-0 text-muted-foreground hover:text-destructive"
          title={t("session.delete_title")}
          disabled={sessionBusy || deleting}
          onClick={(e) => handleDeleteClick(e, s)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setSwitchOpen(true)}
        title={t("session.switch_title")}
      >
        <List className="size-3.5" />
        {t("session.switch")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleNewChat()}
        title={t("session.new_title")}
      >
        <Plus className="size-3.5" />
        {t("session.new")}
      </Button>

      <Dialog.Root open={switchOpen} onOpenChange={setSwitchOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <Dialog.Title className="text-base font-semibold">
                {t("session.switch_title")}
              </Dialog.Title>
              <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="space-y-1 p-2">
                {activeSessions.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {t("session.no_active")}
                  </p>
                )}
                {activeSessions.map((s) => renderSessionRow(s))}
                {archivedSessions.length > 0 && (
                  <>
                    <p className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <Archive className="size-3" />
                      {t("session.archived", { count: archivedSessions.length })}
                    </p>
                    {archivedSessions.map((s) => renderSessionRow(s, true))}
                  </>
                )}
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[60] bg-black/50 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
            <Dialog.Title className="text-base font-semibold">
              {t("session.delete_title")}
            </Dialog.Title>
            <p className="mt-3 text-sm text-muted-foreground">{deletePrompt}</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={deleting}
                onClick={() => void handleDeleteConfirm()}
              >
                {deleting ? t("common.deleting") : t("common.confirm_delete")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
