import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router"
import {
  ArchiveIcon,
  BotIcon,
  BrainIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  CpuIcon,
  ListTodoIcon,
  Loader2Icon,
  MessageSquareIcon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  UserIcon,
  WrenchIcon,
} from "lucide-react"
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
import { Body, Inline, Page, ScrollRegion, Stack } from "@/components/blocks/surfaces"
import { EmptyState } from "@/components/blocks/state-boundary"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group"
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
import type { ACPPlanEntry, AgentKind, IngestSession, IngestSessionMessage, SessionListItem } from "@/types"

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

type RecencyKey = "today" | "yesterday" | "week" | "older"

const RECENCY_GROUPS: readonly { key: RecencyKey; label: string; recent: boolean }[] = [
  { key: "today", label: "今天", recent: true },
  { key: "yesterday", label: "昨天", recent: true },
  { key: "week", label: "7 天内", recent: false },
  { key: "older", label: "更早", recent: false },
]

function recencyBucket(time: string | undefined, now: Date): RecencyKey {
  if (!time) return "older"
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const parsed = new Date(time).getTime()
  if (Number.isNaN(parsed)) return "older"
  if (parsed >= start) return "today"
  if (parsed >= start - 86_400_000) return "yesterday"
  if (parsed >= start - 6 * 86_400_000) return "week"
  return "older"
}

function ChatPane({ sessionId, onCreate, creating }: { sessionId: string | undefined; onCreate: () => void; creating: boolean }) {
  const [filter, setFilter] = useState("")
  const sessionsQuery = useQuery({ queryKey: ["ingest-sessions"], queryFn: listIngestSessions })
  const sessions = useMemo(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (needle === "") return sessions
    return sessions.filter((session) => (session.title || "未命名对话").toLowerCase().includes(needle))
  }, [sessions, filter])

  const grouped = useMemo(() => {
    const now = new Date()
    const map = new Map<RecencyKey, SessionListItem[]>()
    for (const session of filtered) {
      const key = recencyBucket(session.updated_at, now)
      map.set(key, [...(map.get(key) ?? []), session])
    }
    return map
  }, [filtered])

  return (
    <>
      <PaneHeader>
        <div className="llmwiki-chat-pane-title">
          <MessageSquareIcon className="size-4 shrink-0 llmwiki-tone-sky" aria-hidden="true" />
          <span className="truncate text-sm font-medium">会话</span>
          {sessions.length > 0 ? <span className="llmwiki-chat-count">{sessions.length}</span> : null}
        </div>
        <Button size="sm" variant="ghost" disabled={creating} onClick={onCreate}>
          <PlusIcon />新对话
        </Button>
      </PaneHeader>
      {sessions.length > 0 ? (
        <PaneSection>
          <InputGroup>
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput
              aria-label="筛选会话"
              placeholder="搜索对话…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </InputGroup>
        </PaneSection>
      ) : null}
      <PaneSection grow>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有会话，点“新对话”开始。</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有匹配“{filter}”的会话。</p>
        ) : (
          <div className="llmwiki-chat-groups" aria-label="会话列表">
            {RECENCY_GROUPS.map((group) => {
              const list = grouped.get(group.key)
              if (list === undefined || list.length === 0) return null
              return (
                <section key={group.key} className="llmwiki-chat-group" aria-label={group.label}>
                  <h2 className="llmwiki-chat-group-header">
                    {group.recent ? <Clock3Icon aria-hidden="true" /> : <CalendarClockIcon aria-hidden="true" />}
                    <span>{group.label}</span>
                  </h2>
                  <ul className="llmwiki-chat-list">
                    {list.map((session) => {
                      const active = sessionId === session.id
                      const archived = session.status === "archived"
                      const title = session.title || "未命名对话"
                      return (
                        <li key={session.id} className="llmwiki-chat-item" data-active={active ? "true" : "false"}>
                          <AppLink
                            to={`/chat/${session.id}`}
                            aria-current={active ? "page" : undefined}
                            className="llmwiki-chat-item-link"
                          >
                            <span className="llmwiki-chat-item-avatar" data-archived={archived ? "true" : "false"} aria-hidden="true">
                              {archived ? <ArchiveIcon /> : <MessageSquareTextIcon />}
                            </span>
                            <span className="llmwiki-chat-item-body">
                              <span className="llmwiki-chat-item-title">{title}</span>
                              <span className="llmwiki-chat-item-meta">
                                <Time value={session.updated_at} />
                                {archived ? <span className="llmwiki-chat-item-tag">已归档</span> : null}
                              </span>
                            </span>
                          </AppLink>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </PaneSection>
    </>
  )
}

function ModelPicker({ session }: { session: IngestSession }) {
  const { instances } = useApp()
  const queryClient = useQueryClient()
  const [instanceId, setInstanceId] = useState(session.llm_instance_id || instances[0]?.id || "")
  useEffect(() => {
    setInstanceId(session.llm_instance_id || instances[0]?.id || "")
  }, [session.id, session.llm_instance_id, instances])
  const instance = instances.find((item) => item.id === instanceId)
  const configuredModels = instance?.models ?? []
  const catalogId = instance?.catalog_id ?? ""
  const modelsQuery = useQuery({
    queryKey: ["provider-models", catalogId],
    queryFn: () => listProviderModels(catalogId),
    enabled: catalogId !== "" && catalogId !== "custom" && configuredModels.length === 0,
  })
  const fallbackModels = (modelsQuery.data ?? []).map((m) => ({
    id: m.model_id,
    label: m.name || m.model_id,
  }))
  const modelOptions =
    configuredModels.length > 0
      ? configuredModels.map((id) => ({ id, label: id }))
      : fallbackModels
  const selectedInstanceId = instance === undefined ? "" : instanceId
  const selectedModel = modelOptions.some((model) => model.id === session.llm_model) ? session.llm_model : ""
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
          <CpuIcon className="llmwiki-tone-indigo" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64">
        <Stack gap="sm">
          <span className="text-xs text-muted-foreground">模型</span>
          <Select
            value={selectedInstanceId}
            onValueChange={(value) => {
              setInstanceId(value)
              const nextInst = instances.find((item) => item.id === value)
              const nextModels = nextInst?.models ?? []
              const nextModel = nextModels.includes(session.llm_model)
                ? session.llm_model
                : (nextModels[0] ?? "")
              if (nextModel !== "") {
                update.mutate({ nextInstanceId: value, model: nextModel })
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
            disabled={modelOptions.length === 0}
            onValueChange={(model) => update.mutate({ nextInstanceId: instanceId, model })}
          >
            <SelectTrigger aria-label="对话模型" size="sm" className="w-full"><SelectValue placeholder="选择模型" /></SelectTrigger>
            <SelectContent>
              {modelOptions.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Stack>
      </PopoverContent>
    </Popover>
  )
}

function HarnessPicker({ session }: { session: IngestSession }) {
  const { acpAgents, instances, settings } = useApp()
  const queryClient = useQueryClient()
  const enabledAgents = acpAgents.filter((a) => a.enabled)
  const currentKind: AgentKind = session.agent_kind ?? settings?.harnix_settings?.defaultKind ?? "native"
  const currentAcpId = session.acp_agent_id || settings?.harnix_settings?.acp.defaultAgentId || ""
  const archived = session.status === "archived"

  const update = useMutation({
    mutationFn: ({
      kind,
      acpAgentId,
      instanceId,
      model,
    }: {
      kind: AgentKind
      acpAgentId?: string
      instanceId?: string
      model?: string
    }) =>
      updateIngestSession(session.id, {
        agent_kind: kind,
        ...(acpAgentId !== undefined ? { acp_agent_id: acpAgentId } : {}),
        ...(instanceId !== undefined ? { instance_id: instanceId } : {}),
        ...(model !== undefined ? { model } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingest-session", session.id] })
      notify.success("Harness 已更新")
    },
    onError: (error: Error) => notify.error(error),
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Harness 设置" title={`Harness: ${currentKind}`} disabled={archived}>
          <BotIcon className="llmwiki-tone-violet" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64">
        <Stack gap="sm">
          <span className="text-xs text-muted-foreground">Harness 运行时</span>
          <Select
            value={currentKind}
            disabled={archived || update.isPending}
            onValueChange={(value) => {
              const kind = value as AgentKind
              const acpAgentId = kind === "acp" ? (currentAcpId || enabledAgents[0]?.id || "") : ""
              if (kind === "acp") {
                update.mutate({ kind, acpAgentId })
                return
              }
              const bound = kind === "pi" ? settings?.harnix_settings?.pi : settings?.harnix_settings?.native
              const boundInstanceId = bound?.providerInstanceId?.trim() ?? ""
              const boundModel = bound?.model?.trim() ?? ""
              const inst = instances.find((item) => item.id === boundInstanceId)
              const validModel =
                inst !== undefined && boundModel !== "" && (inst.models ?? []).includes(boundModel)
                  ? boundModel
                  : ""
              update.mutate({
                kind,
                acpAgentId,
                ...(inst !== undefined ? { instanceId: inst.id } : {}),
                ...(inst !== undefined && validModel !== "" ? { model: validModel } : {}),
              })
            }}
          >
            <SelectTrigger aria-label="对话 Harness 实现" size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="native">Native</SelectItem>
              <SelectItem value="pi">Pi AI</SelectItem>
              <SelectItem value="acp">ACP</SelectItem>
            </SelectContent>
          </Select>
          {currentKind === "acp" ? (
            <Select
              value={currentAcpId}
              disabled={archived || enabledAgents.length === 0 || update.isPending}
              onValueChange={(acpAgentId) => update.mutate({ kind: "acp", acpAgentId })}
            >
              <SelectTrigger aria-label="对话 ACP Agent" size="sm" className="w-full">
                <SelectValue placeholder={enabledAgents.length === 0 ? "无已启用 Agent" : "选择 ACP Agent"} />
              </SelectTrigger>
              <SelectContent>
                {enabledAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
        </Stack>
      </PopoverContent>
    </Popover>
  )
}

function PlanStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2Icon className="llmwiki-plan-icon llmwiki-tone-emerald" aria-hidden="true" />
  if (status === "in_progress") return <Loader2Icon className="llmwiki-plan-icon llmwiki-tone-sky animate-spin" aria-hidden="true" />
  return <CircleIcon className="llmwiki-plan-icon text-muted-foreground" aria-hidden="true" />
}

function MessageView({ message, onRetry }: { message: IngestSessionMessage; onRetry: () => void }) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"
  return (
    <Turn>
      <Message
        meta={
          <>
            <span className="llmwiki-role-badge">
              <span
                className={
                  isUser
                    ? "llmwiki-role-icon llmwiki-role-icon--user"
                    : isSystem
                      ? "llmwiki-role-icon llmwiki-role-icon--system"
                      : "llmwiki-role-icon llmwiki-role-icon--assistant"
                }
                aria-hidden="true"
              >
                {isUser ? <UserIcon /> : isSystem ? <BotIcon /> : <SparklesIcon />}
              </span>
              {isUser ? "你" : isSystem ? "系统" : "助手"}
            </span>
            {message.created_at !== "" ? <> · <Time value={message.created_at} /></> : null}
          </>
        }
      >
        {message.tool_status != null ? (
          <Steps
            summary={
              <span className="llmwiki-step-summary">
                <WrenchIcon className="llmwiki-tone-amber" aria-hidden="true" />
                <span>{message.tool_status}</span>
              </span>
            }
            defaultOpen
          />
        ) : null}
        {message.thought_text !== undefined && message.thought_text !== "" ? (
          <Steps
            summary={
              <span className="llmwiki-step-summary">
                <BrainIcon className="llmwiki-tone-violet" aria-hidden="true" />
                <span>思考过程</span>
              </span>
            }
          >
            <Step>{message.thought_text}</Step>
          </Steps>
        ) : null}
        {message.plan_entries !== undefined && message.plan_entries.length > 0 ? (
          <Steps
            summary={
              <span className="llmwiki-step-summary">
                <ListTodoIcon className="llmwiki-tone-sky" aria-hidden="true" />
                <span>计划 {message.plan_entries.length} 项</span>
              </span>
            }
            defaultOpen
          >
            {message.plan_entries.map((entry: ACPPlanEntry, index: number) => (
              <Step key={`${index}-${entry.content}`}>
                <PlanStatusIcon status={entry.status} />
                <span>{entry.content}</span>
              </Step>
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

function SessionAction({ label, icon, onSelect, destructive = false, disabled = false }: {
  label: string
  icon: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip delayDuration={600}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onSelect}
          className={destructive ? "text-destructive hover:text-destructive" : undefined}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function Conversation({ session }: { session: IngestSession }) {
  const { settings } = useApp()
  const queryClient = useQueryClient()
  const sessionKind: AgentKind = session.agent_kind ?? settings?.harnix_settings?.defaultKind ?? "native"
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
      primary={(
        <>
          <SessionAction label="重命名" icon={<PencilIcon />} onSelect={() => setRenaming({ id: session.id, title: session.title || "" })} />
          <SessionAction label="归档" icon={<ArchiveIcon />} onSelect={() => archive.mutate()} />
          <SessionAction label="刷新" icon={<RotateCcwIcon />} onSelect={() => { void messagesQuery.refetch() }} />
          <SessionAction
            label="删除"
            icon={<Trash2Icon />}
            destructive
            disabled={remove.isPending}
            onSelect={async () => {
              const ok = await confirm({
                title: `删除会话「${session.title || "未命名对话"}」？`,
                description: "会话消息会一并删除，已归档的评审不受影响。",
                confirmLabel: "删除",
                destructive: true,
              })
              if (ok) remove.mutate()
            }}
          />
        </>
      )}
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
            <HarnessPicker session={session} />
            {sessionKind !== "acp" ? <ModelPicker session={session} /> : null}
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
