import { useEffect, useState } from "react"
import { useApp } from "@/context/AppContext"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Plus,
  MessageSquare,
  Archive,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

export function ChatSidebar() {
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

  const [collapsed, setCollapsed] = useState(false)

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

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-r py-2 px-1 bg-card">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Separator className="my-2" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleNewChat()}
          title="New chat"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex w-64 flex-col border-r bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">Sessions</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleNewChat()}
            title="New chat"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {activeSessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No active sessions
            </p>
          )}
          {activeSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => void switchSession(s.id)}
              className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                s.id === activeSessionId
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted"
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="size-3.5 shrink-0" />
                <span className="truncate">
                  {s.title || "Untitled"}
                </span>
              </div>
              {(s.llm_instance_id || s.llm_model) && (
                <div className="flex items-center gap-1 mt-1 ml-5.5">
                  <span className="text-xs text-muted-foreground truncate">
                    {getInstanceName(s.llm_instance_id)}
                    {s.llm_model ? ` / ${s.llm_model}` : ""}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
        {archivedSessions.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <div className="flex items-center gap-1 px-3 py-1">
                <Archive className="size-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">
                  Archived ({archivedSessions.length})
                </span>
              </div>
              <div className="space-y-1 opacity-60">
                {archivedSessions.slice(0, 10).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-muted-foreground">
                      {s.title || "Untitled"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  )
}
