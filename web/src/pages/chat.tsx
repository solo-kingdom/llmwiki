import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router"
import { ArchiveIcon, CpuIcon, PaperclipIcon, PencilIcon, PlusIcon, RotateCcwIcon, SendIcon, SquareIcon, Trash2Icon } from "lucide-react"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import {
  AttachmentChip,
  ComposerDock,
  Message,
  Step,
  Steps,
  StreamingCursor,
  Transcript,
  TranscriptEmpty,
  Turn,
} from "@/components/blocks/conversation"
import { Time } from "@/components/blocks/format"
import { ListDetailLayout, ListPaneTrigger, PaneHeader, PaneSection } from "@/components/blocks/list-detail"
import { Markdown } from "@/components/blocks/markdown"
import { AppLink } from "@/components/blocks/router"
import { Body, Inline, Page, Row, Rows, ScrollRegion, Stack } from "@/components/blocks/surfaces"
import { EmptyState } from "@/components/blocks/state-boundary"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp } from "@/context/app-context"
import {
  archiveIngestSession,
  createIngestSession,
  deleteIngestSession,
  getIngestSession,
  listIngestSessionMessages,
  listIngestSessions,
  listProviderModels,
  streamIngestSessionMessage,
  streamRetryIngestSessionMessage,
  updateIngestSession,
  uploadIngestSessionAttachment,
} from "@/lib/api"
import type { ACPPlanEntry, IngestSession, IngestSessionMessage } from "@/types"

function payloadString(data: unknown, key: string): string {
  if (typeof data !== "object" || data === null) return ""
  const value = (data as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

function upsertMessage(list: IngestSessionMessage[], next: IngestSessionMessage): IngestSessionMessage[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index < 0) return [...list, next]
  const copy = [...list]
  copy[index] = next
  return copy
}

function patchMessage(
  list: IngestSessionMessage[],
  id: string,
  patch: (message: IngestSessionMessage) => IngestSessionMessage,
): IngestSessionMessage[] {
  return list.map((message) => (message.id === id ? patch(message) : message))
}

function ChatPane({ sessionId, onCreate, creating }: { sessionId: string | undefined; onCreate: () => void; creating: boolean }) {
  const sessionsQuery = useQuery({ queryKey: ["ingest-sessions"], queryFn: listIngestSessions })
  const sessions = sessionsQuery.data?.sessions ?? []

  return (
    <>
      <PaneHeader>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">会话</span>
        <Button size="sm" variant="ghost" disabled={creating} onClick={onCreate}>
          <PlusIcon />新对话
        </Button>
      </PaneHeader>
      <PaneSection grow>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有会话，点“新对话”开始。</p>
        ) : (
          <Rows label="会话列表">
            {sessions.map((session) => (
              <Row key={session.id}>
                <div className="min-w-0 flex-1">
                  <AppLink
                    to={`/chat/${session.id}`}
                    aria-current={sessionId === session.id ? "page" : undefined}
                    className="block truncate text-sm hover:text-brand"
                  >
                    {session.title || "未命名对话"}
                  </AppLink>
                  <div className="text-xs text-muted-foreground">
                    <Time value={session.updated_at} mode="datetime" />
                  </div>
                </div>
              </Row>
            ))}
          </Rows>
        )}
      </PaneSection>
    </>
  )
}

function ModelPicker({ session }: { session: IngestSession }) {
  const { instances } = useApp()
  const queryClient = useQueryClient()
  const [instanceId, setInstanceId] = useState(session.llm_instance_id || instances[0]?.id || "")
  const instance = instances.find((item) => item.id === instanceId)
  const catalogId = instance?.catalog_id ?? ""
  const modelsQuery = useQuery({
    queryKey: ["provider-models", catalogId],
    queryFn: () => listProviderModels(catalogId),
    enabled: catalogId !== "",
  })
  const models = modelsQuery.data ?? []
  const selectedInstanceId = instance === undefined ? "" : instanceId
  const selectedModel = models.some((model) => model.model_id === session.llm_model) ? session.llm_model : ""
  const update = useMutation({
    mutationFn: ({ nextInstanceId, model }: { nextInstanceId: string; model: string }) =>
      updateIngestSession(session.id, { instance_id: nextInstanceId, model }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingest-session", session.id] })
      notify.success("模型已更新")
    },
    onError: (error: Error) => notify.error(error),
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="模型设置" title="模型设置">
          <CpuIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64">
        <Stack gap="sm">
          <span className="text-xs text-muted-foreground">模型</span>
          <Select
            value={selectedInstanceId}
            onValueChange={(value) => {
              setInstanceId(value)
              if (value === session.llm_instance_id && session.llm_model !== "") {
                update.mutate({ nextInstanceId: value, model: session.llm_model })
              }
            }}
          >
            <SelectTrigger aria-label="对话 Provider 实例" size="sm" className="w-full"><SelectValue placeholder="选择实例" /></SelectTrigger>
            <SelectContent>
              {instances.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={selectedModel}
            disabled={models.length === 0}
            onValueChange={(model) => update.mutate({ nextInstanceId: instanceId, model })}
          >
            <SelectTrigger aria-label="对话模型" size="sm" className="w-full"><SelectValue placeholder="选择模型" /></SelectTrigger>
            <SelectContent>
              {models.map((model) => <SelectItem key={model.model_id} value={model.model_id}>{model.name || model.model_id}</SelectItem>)}
            </SelectContent>
          </Select>
        </Stack>
      </PopoverContent>
    </Popover>
  )
}

function MessageView({ message, onRetry }: { message: IngestSessionMessage; onRetry: () => void }) {
  const isUser = message.role === "user"
  return (
    <Turn>
      <Message
        meta={
          <>
            {isUser ? "你" : message.role === "system" ? "系统" : "助手"}
            {message.created_at !== "" ? <> · <Time value={message.created_at} /></> : null}
          </>
        }
      >
        {message.tool_status != null ? <Steps summary={message.tool_status} defaultOpen /> : null}
        {message.thought_text !== undefined && message.thought_text !== "" ? (
          <Steps summary="思考过程"><Step>{message.thought_text}</Step></Steps>
        ) : null}
        {message.plan_entries !== undefined && message.plan_entries.length > 0 ? (
          <Steps summary={`计划 ${message.plan_entries.length} 项`} defaultOpen>
            {message.plan_entries.map((entry: ACPPlanEntry, index: number) => (
              <Step key={`${index}-${entry.content}`}>{entry.status} · {entry.content}</Step>
            ))}
          </Steps>
        ) : null}
        {message.content === "" && message.stream_status === "streaming"
          ? <StreamingCursor />
          : isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <Markdown>{message.content}</Markdown>}
        {message.warning_message !== undefined ? <p className="text-xs text-warning">{message.warning_message}</p> : null}
        {message.error_message !== undefined ? <p className="text-xs text-destructive">{message.error_message}</p> : null}
      </Message>
      {!isUser && (message.stream_status === "failed" || message.stream_status === "incomplete") ? (
        <Button size="sm" variant="ghost" onClick={onRetry}><RotateCcwIcon />重试</Button>
      ) : null}
    </Turn>
  )
}

function Conversation({ session }: { session: IngestSession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const messagesQuery = useQuery({
    queryKey: ["session-messages", session.id],
    queryFn: () => listIngestSessionMessages(session.id),
  })
  const [live, setLive] = useState<IngestSessionMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [attachmentName, setAttachmentName] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const assistantIdRef = useRef("")

  const messages = useMemo(() => {
    const byId = new Map<string, IngestSessionMessage>()
    for (const message of messagesQuery.data?.messages ?? []) byId.set(message.id, message)
    for (const message of live) byId.set(message.id, message)
    return [...byId.values()]
  }, [messagesQuery.data, live])

  const handleEvent = (event: string, data: unknown) => {
    if (event === "user_message") {
      setLive((prev) => upsertMessage(prev, data as IngestSessionMessage))
      return
    }
    if (event === "assistant_start") {
      const id = payloadString(data, "id")
      assistantIdRef.current = id
      setLive((prev) => upsertMessage(prev, {
        id, session_id: session.id, role: "assistant", content: "", message_type: "text",
        attachment_id: "", stream_status: "streaming", created_at: "",
      }))
      return
    }
    const assistantId = assistantIdRef.current
    if (event === "token") {
      const content = payloadString(data, "content")
      setLive((prev) => patchMessage(prev, assistantId, (message) => ({ ...message, content: message.content + content })))
      return
    }
    if (event === "thought") {
      const content = payloadString(data, "content")
      setLive((prev) => patchMessage(prev, assistantId, (message) => ({ ...message, thought_text: (message.thought_text ?? "") + content })))
      return
    }
    if (event === "tool_start") {
      const tool = payloadString(data, "tool")
      const detail = payloadString(data, "detail")
      setLive((prev) => patchMessage(prev, assistantId, (message) => ({
        ...message,
        tool_status: detail !== "" ? `${tool} · ${detail}` : tool,
        tool_reads: [...(message.tool_reads ?? []), detail !== "" ? `${tool} · ${detail}` : tool],
      })))
      return
    }
    if (event === "tool_done") {
      setLive((prev) => patchMessage(prev, assistantId, (message) => ({ ...message, tool_status: null })))
      return
    }
    if (event === "plan") {
      const entries = typeof data === "object" && data !== null
        ? (data as Record<string, unknown>).entries
        : undefined
      if (Array.isArray(entries)) {
        setLive((prev) => patchMessage(prev, assistantId, (message) => ({ ...message, plan_entries: entries as ACPPlanEntry[] })))
      }
      return
    }
    if (event === "permission") {
      notify.info("Agent 请求权限，已按配置处理")
      return
    }
    if (event === "warning") {
      const message = payloadString(data, "message")
      setLive((prev) => patchMessage(prev, assistantId, (item) => ({ ...item, warning_message: message })))
      return
    }
    if (event === "error") {
      const message = payloadString(data, "message")
      setLive((prev) => patchMessage(prev, assistantId, (item) => ({ ...item, error_message: message, stream_status: "failed" })))
      return
    }
    if (event === "done") {
      const done = data as IngestSessionMessage
      setLive((prev) => upsertMessage(prev, done))
      void queryClient.invalidateQueries({ queryKey: ["session-messages", session.id] })
      void queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
    }
  }

  const send = async () => {
    const text = input.trim()
    if (text === "" || sending) return
    setInput("")
    setSending(true)
    setLive([])
    assistantIdRef.current = ""
    try {
      await streamIngestSessionMessage(session.id, text, handleEvent)
    } catch (error) {
      notify.error(error)
    } finally {
      setSending(false)
      setLive([])
      void queryClient.invalidateQueries({ queryKey: ["session-messages", session.id] })
      void queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
    }
  }

  const retry = async (message: IngestSessionMessage) => {
    if (sending) return
    setSending(true)
    setLive([])
    assistantIdRef.current = message.id
    try {
      await streamRetryIngestSessionMessage(session.id, message.id, handleEvent)
    } catch (error) {
      notify.error(error)
    } finally {
      setSending(false)
      void queryClient.invalidateQueries({ queryKey: ["session-messages", session.id] })
    }
  }

  const archive = useMutation({
    mutationFn: () => archiveIngestSession(session.id, session.title),
    onSuccess: (result) => {
      notify.success(`已归档：${result.review_id}`)
      void queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
    },
    onError: (error: Error) => notify.error(error),
  })
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const rename = useMutation({
    mutationFn: (value: { id: string; title: string }) => updateIngestSession(value.id, { title: value.title }),
    onSuccess: async () => {
      notify.success("会话已重命名")
      setRenaming(null)
      await queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
      await queryClient.invalidateQueries({ queryKey: ["ingest-session", session.id] })
    },
    onError: (error: Error) => notify.error(error),
  })
  const remove = useMutation({
    mutationFn: () => deleteIngestSession(session.id),
    onSuccess: async () => {
      notify.success("会话已删除")
      await queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
      navigate("/chat")
    },
    onError: (error: Error) => notify.error(error),
  })

  const upload = useMutation({
    mutationFn: (file: File) => uploadIngestSessionAttachment(session.id, file),
    onSuccess: (result) => {
      setAttachmentName(result.message.attachment_id !== "" ? result.message.attachment_id : "已上传附件")
      void queryClient.invalidateQueries({ queryKey: ["session-messages", session.id] })
      notify.success("附件已上传")
    },
    onError: (error: Error) => notify.error(error),
  })

  return (
    <Page
      title={session.title || "新对话"}
      layout="fill"
      leading={<ListPaneTrigger />}
      actions={[
        { label: "编辑", icon: <PencilIcon />, iconOnly: true, onSelect: () => setRenaming({ id: session.id, title: session.title || "" }) },
        { label: "归档", icon: <ArchiveIcon />, iconOnly: true, onSelect: () => archive.mutate() },
        { label: "刷新", icon: <RotateCcwIcon />, iconOnly: true, onSelect: () => { void messagesQuery.refetch() } },
        {
          label: "删除",
          icon: <Trash2Icon />,
          iconOnly: true,
          destructive: true,
          disabled: remove.isPending,
          onSelect: async () => {
            const ok = await confirm({
              title: `删除会话「${session.title || "未命名对话"}」？`,
              description: "会话消息会一并删除，已归档的评审不受影响。",
              confirmLabel: "删除",
              destructive: true,
            })
            if (ok) remove.mutate()
          },
        },
      ]}
    >
      <ScrollRegion name="conversation" follow>
        <Body width="reading">
          {messages.length === 0 ? (
            <Transcript label="对话"><TranscriptEmpty>发一条消息开始整理你的知识库。</TranscriptEmpty></Transcript>
          ) : (
            <Transcript label="对话">
              {messages.map((message) => (
                <MessageView key={message.id} message={message} onRetry={() => { void retry(message) }} />
              ))}
            </Transcript>
          )}
        </Body>
      </ScrollRegion>
      <ComposerDock>
        <InputGroup>
          <InputGroupTextarea
            aria-label="输入消息"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <ModelPicker session={session} />
            <Stack direction="row" gap="xs" grow justify="end">
              <Button size="icon-sm" variant="ghost" aria-label="上传附件" title="上传附件" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                <PaperclipIcon />
              </Button>
              <Button size="icon-sm" aria-label="发送" title="发送" disabled={sending || input.trim() === ""} onClick={() => { void send() }}>
                {sending ? <SquareIcon /> : <SendIcon />}
              </Button>
            </Stack>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) upload.mutate(file)
                event.target.value = ""
              }}
            />
          </InputGroupAddon>
        </InputGroup>
        {attachmentName !== "" ? (
          <Stack gap="sm" align="center">
            <AttachmentChip icon={<PaperclipIcon />} name={attachmentName} meta="附件" />
          </Stack>
        ) : null}
      </ComposerDock>
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>标题只影响列表展示。</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="会话标题"
            value={renaming?.title ?? ""}
            onChange={(event) => setRenaming((current) => current === null ? current : { ...current, title: event.target.value })}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>取消</Button>
            <Button
              disabled={renaming === null || renaming.title.trim() === "" || rename.isPending}
              onClick={() => { if (renaming !== null) rename.mutate({ id: renaming.id, title: renaming.title.trim() }) }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

export function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({
    queryKey: ["ingest-session", id],
    queryFn: () => getIngestSession(id ?? ""),
    enabled: id !== undefined,
  })
  const create = useMutation({
    mutationFn: () => createIngestSession("新对话"),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ingest-sessions"] })
      navigate(`/chat/${result.session.id}`)
    },
    onError: (error: Error) => notify.error(error),
  })

  const session = sessionQuery.data?.session
  return (
    <ListDetailLayout label="会话列表" pane={<ChatPane sessionId={id} creating={create.isPending} onCreate={() => create.mutate()} />}>
      {session !== undefined ? (
        <Conversation session={session} />
      ) : (
        <Page title={id === undefined ? "对话" : "加载中…"} layout="fill">
          <Body width="reading">
            {sessionQuery.error !== null ? (
              <p className="text-sm text-destructive">{sessionQuery.error.message}</p>
            ) : id === undefined ? (
              <EmptyState
                title="开始一次对话"
                description="选择一个会话，或新建一个来整理知识库。"
                action={
                  <Inline gap="sm">
                    <ListPaneTrigger />
                    <Button onClick={() => create.mutate()} disabled={create.isPending}><PlusIcon />新对话</Button>
                    <Button variant="outline" asChild><AppLink to="/jobs">查看任务</AppLink></Button>
                  </Inline>
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">正在加载会话…</p>
            )}
          </Body>
        </Page>
      )}
    </ListDetailLayout>
  )
}
