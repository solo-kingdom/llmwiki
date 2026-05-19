import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { useApp } from "@/context/AppContext"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Plus,
  MessageSquare,
  Archive,
  List,
  X,
} from "lucide-react"

export function SessionControls() {
  const {
    sessions,
    activeSessionId,
    instances,
    settings,
    createSession,
    switchSession,
    listSessions,
    loadInstances,
    loadSettings,
  } = useApp()

  const [switchOpen, setSwitchOpen] = useState(false)

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

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setSwitchOpen(true)}
        title="切换会话"
      >
        <List className="size-3.5" />
        切换
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleNewChat()}
        title="新建会话"
      >
        <Plus className="size-3.5" />
        新建
      </Button>

      <Dialog.Root open={switchOpen} onOpenChange={setSwitchOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-background shadow-lg outline-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-[opacity,scale] duration-200">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <Dialog.Title className="text-base font-semibold">
                切换会话
              </Dialog.Title>
              <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-1 p-2">
                {activeSessions.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    暂无活跃会话
                  </p>
                )}
                {activeSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void handleSwitch(s.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      s.id === activeSessionId
                        ? "bg-primary/10 font-medium text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="size-3.5 shrink-0" />
                      <span className="truncate">{s.title || "Untitled"}</span>
                    </div>
                    {(s.llm_instance_id || s.llm_model) && (
                      <p className="mt-1 truncate pl-5.5 text-xs text-muted-foreground">
                        {getInstanceName(s.llm_instance_id)}
                        {s.llm_model ? ` / ${s.llm_model}` : ""}
                      </p>
                    )}
                  </button>
                ))}
                {archivedSessions.length > 0 && (
                  <>
                    <p className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <Archive className="size-3" />
                      已归档 ({archivedSessions.length})
                    </p>
                    {archivedSessions.slice(0, 10).map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm opacity-60"
                      >
                        <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">
                          {s.title || "Untitled"}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </ScrollArea>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
