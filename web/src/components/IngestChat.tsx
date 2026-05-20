import { useCallback, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useApp } from "@/context/AppContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ModelSelectDialog } from "@/components/ModelSelectDialog"
import { SessionControls } from "@/components/SessionControls"
import type { IngestSessionMessage } from "@/types"
import {
  Archive,
  Bot,
  Copy,
  Cpu,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  SlidersHorizontal,
} from "lucide-react"

function findRetryUserContent(
  messages: IngestSessionMessage[],
  failedMsgId: string,
): string | null {
  const idx = messages.findIndex((m) => m.id === failedMsgId)
  if (idx <= 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "user" && m.content.trim()) {
      return m.content
    }
  }
  return null
}

function MessageBubble({
  msg,
  messages,
  onRetry,
  sessionBusy,
}: {
  msg: IngestSessionMessage
  messages: IngestSessionMessage[]
  onRetry: (content: string) => void
  sessionBusy: boolean
}) {
  const isUser = msg.role === "user"
  const failed = msg.stream_status === "failed"
  const retryContent = failed ? findRetryUserContent(messages, msg.id) : null

  const handleCopy = async () => {
    const text = msg.content?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore clipboard failures
    }
  }

  const isStreaming = msg.stream_status === "streaming"
  const hasContent = !!msg.content?.trim()

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[92%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : msg.message_type === "attachment_summary"
              ? "bg-muted border border-dashed"
              : "bg-muted"
        }`}
      >
        <button
          type="button"
          className="absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity hover:bg-background/20 group-hover:opacity-100"
          title="复制"
          onClick={() => void handleCopy()}
        >
          <Copy className="size-3.5" />
        </button>
        {isUser ? (
          <p className="whitespace-pre-wrap pr-6">{msg.content}</p>
        ) : isStreaming && !hasContent ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="正在回复"
          />
        ) : isStreaming ? (
          <p className="whitespace-pre-wrap pr-6">{msg.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none pr-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
        {failed && (
          <div className="mt-2 space-y-1 border-t border-destructive/20 pt-2">
            <p className="text-xs text-destructive">
              {msg.error_message || "回复失败"}
            </p>
            {retryContent && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={sessionBusy}
                onClick={() => onRetry(retryContent)}
              >
                <RotateCcw className="size-3" />
                重新发送
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function IngestChat() {
  const {
    sessionId,
    sessionMessages,
    sessionBusy,
    sessionError,
    settings,
    instances,
    currentModels,
    activeSessionId,
    sessions,
    ensureIngestSession,
    sendSessionMessage,
    uploadSessionAttachment,
    archiveSession,
    refreshIngestJobs,
    loadCapabilities,
    loadInstances,
    loadModels,
    updateSessionLLM,
    loadSettings,
    listSessions,
  } = useApp()

  const [input, setInput] = useState("")
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTitle, setArchiveTitle] = useState("")
  const [archiveResult, setArchiveResult] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void ensureIngestSession()
    void loadCapabilities()
    void refreshIngestJobs()
    void loadInstances()
    void loadSettings()
    void listSessions()
  }, [
    ensureIngestSession,
    loadCapabilities,
    refreshIngestJobs,
    loadInstances,
    loadSettings,
    listSessions,
  ])

  useEffect(() => {
    const el = bottomRef.current
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" })
    }
  }, [sessionMessages])

  useEffect(() => {
    if (!selectedInstanceId && settings?.last_instance_id) {
      setSelectedInstanceId(settings.last_instance_id)
    }
  }, [settings, selectedInstanceId])

  useEffect(() => {
    const active = sessions.find(
      (s) => s.id === (activeSessionId ?? sessionId),
    )
    if (active?.llm_instance_id) {
      setSelectedInstanceId(active.llm_instance_id)
    }
    if (active?.llm_model) {
      setSelectedModel(active.llm_model)
    }
  }, [activeSessionId, sessionId, sessions])

  useEffect(() => {
    if (selectedInstanceId) {
      const inst = instances.find((i) => i.id === selectedInstanceId)
      if (inst) void loadModels(inst.catalog_id)
    }
  }, [selectedInstanceId, instances, loadModels])

  useEffect(() => {
    if (!selectedModel && settings?.last_model) {
      setSelectedModel(settings.last_model)
    }
  }, [settings, selectedModel])

  useEffect(() => {
    if (selectedModel && currentModels.length > 0) {
      const exists = currentModels.some((m) => m.model_id === selectedModel)
      if (!exists) setSelectedModel("")
    }
  }, [currentModels, selectedModel])

  const isReady = !!sessionId && !!selectedInstanceId && !!selectedModel

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId)
  const selectedModelInfo = currentModels.find((m) => m.model_id === selectedModel)

  const handleLoadModels = useCallback(
    (catalogId: string) => {
      void loadModels(catalogId)
    },
    [loadModels],
  )

  const handleModelConfirm = async (instanceId: string, modelId: string) => {
    setSelectedInstanceId(instanceId)
    setSelectedModel(modelId)
    if (sessionId) {
      try {
        await updateSessionLLM(sessionId, instanceId, modelId)
      } catch {
        // non-critical
      }
    }
  }

  const hasUserMessage = sessionMessages.some((m) => m.role === "user")

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sessionBusy || !isReady) return
    setInput("")
    await sendSessionMessage(text)
  }

  const handleRetry = useCallback(
    (content: string) => {
      if (!content.trim() || sessionBusy || !isReady) return
      void sendSessionMessage(content)
    },
    [sessionBusy, isReady, sendSessionMessage],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const f of Array.from(files)) {
        await uploadSessionAttachment(f)
      }
    },
    [uploadSessionAttachment],
  )

  const handleArchive = async () => {
    const jobId = await archiveSession(archiveTitle || undefined)
    setArchiveResult(jobId)
    setArchiveOpen(false)
    await refreshIngestJobs()
  }

  const inputDisabled = sessionBusy || !sessionId || !isReady

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70"
        data-testid="ingest-message-panel"
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="w-full space-y-4 px-2 py-4 sm:px-3">
            {!isReady && (
              <div className="rounded-lg bg-amber-50 py-8 text-center text-amber-600 dark:bg-amber-950/20">
                <p className="text-sm">
                  {instances.length === 0
                    ? "请先在 Settings 添加 Provider"
                    : !selectedInstanceId || !selectedModel
                      ? "请点击下方「模型」选择 Provider 和 Model"
                      : "正在设置会话..."}
                </p>
              </div>
            )}
            {sessionMessages.length === 0 && isReady && (
              <div className="py-16 text-center text-muted-foreground">
                <p className="mb-2 text-lg">开始一个话题</p>
                <p className="text-sm">
                  与助手多轮对话探索清楚后，点击「归档」写入 wiki
                </p>
              </div>
            )}
            {sessionMessages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                messages={sessionMessages}
                onRetry={handleRetry}
                sessionBusy={sessionBusy}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      {sessionError && (
        <p className="pb-2 text-sm text-destructive">{sessionError}</p>
      )}
      {archiveResult && (
        <p className="pb-2 text-sm text-green-600">
          已提交归档任务：{archiveResult}
        </p>
      )}

      {archiveOpen && (
        <div className="mb-2 space-y-3 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">确认归档</p>
          <Input
            placeholder="会话标题（可选）"
            value={archiveTitle}
            onChange={(e) => setArchiveTitle(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={sessionBusy}
              onClick={() => void handleArchive()}
            >
              确认归档
            </Button>
          </div>
        </div>
      )}

      <div
        className={`mb-6 rounded-xl border p-2 ${
          isDragging ? "border-blue-400 border-dashed bg-blue-50/50" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
        }}
      >
        {(selectedInstance || selectedModel) && (
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
            {selectedInstance && (
              <span className="inline-flex items-center gap-1">
                <Bot className="size-3" />
                {selectedInstance.name}
              </span>
            )}
            {selectedModel && (
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3" />
                {selectedModelInfo?.name ?? selectedModel}
              </span>
            )}
          </div>
        )}
        <textarea
          className="max-h-40 min-h-[72px] w-full resize-y bg-transparent px-2 py-2 text-sm outline-none"
          placeholder={
            !isReady
              ? "选择 Provider 和 Model 后开始..."
              : "输入消息…（Shift+Enter 换行）"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inputDisabled}
        />
        <div className="flex items-center gap-2 pt-1">
          <SessionControls />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModelDialogOpen(true)}
            title="选择模型"
          >
            <SlidersHorizontal className="size-3.5" />
            模型
          </Button>
          <Button
            size="sm"
            disabled={sessionBusy || !hasUserMessage || !sessionId}
            onClick={() => setArchiveOpen(true)}
            title={!hasUserMessage ? "至少需要一条用户消息" : undefined}
          >
            <Archive className="size-3.5" />
            归档
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            disabled={inputDisabled}
            onClick={() => fileRef.current?.click()}
            title="附件"
          >
            <Paperclip className="size-3.5" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={inputDisabled || !input.trim()}
            onClick={() => void handleSend()}
          >
            {sessionBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            发送
          </Button>
        </div>
      </div>

      <ModelSelectDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        instances={instances}
        models={currentModels}
        selectedInstanceId={selectedInstanceId}
        selectedModel={selectedModel}
        onLoadModels={handleLoadModels}
        onConfirm={(instanceId, modelId) => void handleModelConfirm(instanceId, modelId)}
      />
    </div>
  )
}
