import { useCallback, useEffect, useRef, useState } from "react"
import { navigateTo, workbenchViewHref } from "@/lib/wiki-routes"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  formatSessionMessagesForCopy,
  hasCopyableSessionMessages,
} from "@/lib/format-session-messages"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ModelSelectDialog } from "@/components/ModelSelectDialog"
import { MessageDebugDialog } from "@/components/MessageDebugDialog"
import { SessionControls } from "@/components/SessionControls"
import { WikiMentionPicker } from "@/components/WikiMentionPicker"
import type { IngestSessionMessage, WikiRefPayload } from "@/types"
import {
  Archive,
  Bot,
  Bug,
  CircleOff,
  Copy,
  Cpu,
  Lightbulb,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Square,
  Wrench,
} from "lucide-react"

function canRetryAssistant(msg: IngestSessionMessage): boolean {
  return (
    msg.role === "assistant" &&
    (msg.stream_status === "failed" || msg.stream_status === "incomplete")
  )
}

function assistantErrorText(
  msg: IngestSessionMessage,
  t: ReturnType<typeof useT>,
): string | null {
  if (msg.error_message?.trim()) return msg.error_message.trim()
  if (msg.stream_status === "failed") return t("chat.reply_failed")
  if (msg.stream_status === "incomplete") return t("chat.reply_incomplete")
  return null
}

function MessageBubble({
  msg,
  onRetry,
  onToggleExclude,
  onDebug,
  sessionBusy,
}: {
  msg: IngestSessionMessage
  onRetry: (assistantMessageId: string) => void
  onToggleExclude: (messageId: string) => void
  onDebug?: (messageId: string) => void
  sessionBusy: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isUser = msg.role === "user"
  const isFailed =
    msg.stream_status === "failed" || msg.stream_status === "incomplete"
  const errorText = !isUser ? assistantErrorText(msg, t) : null
  const showRetry = canRetryAssistant(msg)

  const isStreaming = msg.stream_status === "streaming"
  const hasContent = !!msg.content?.trim()
  const copyText = msg.content?.trim() || errorText || ""

  const isExcluded = !!msg.exclude_from_archive

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!copyText) return
    const ok = await copyTextToClipboard(copyText)
    if (!ok) return
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    setCopied(true)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const showActionBar =
    (isUser || msg.role === "assistant") &&
    msg.message_type !== "attachment_summary" &&
    !isStreaming

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] ${isExcluded ? "opacity-60" : ""}`}>
        <div
          className={`relative rounded-2xl px-4 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : msg.message_type === "attachment_summary"
                ? "bg-muted border border-dashed"
                : "bg-muted"
          }`}
        >
          {isUser ? (
            <div>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.wiki_refs && msg.wiki_refs.length > 0 && (
                <div className="mt-2 border-t border-primary-foreground/20 pt-2 text-xs opacity-90">
                  <p className="mb-1 font-medium">{t("chat.wiki_refs_label")}</p>
                  <ul className="space-y-0.5">
                    {msg.wiki_refs.map((ref) => (
                      <li key={ref.document_id}>{ref.title || ref.relative_path}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : isStreaming ? (
            <div>
              {msg.warning_message && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-500">
                  {msg.warning_message}
                </p>
              )}
              {!hasContent ? (
                <Loader2
                  className="size-4 animate-spin text-muted-foreground"
                  aria-label={t("chat.replying")}
                />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.tool_status && (
                <p className="mt-2 text-xs text-muted-foreground">{msg.tool_status}</p>
              )}
            </div>
          ) : isFailed && errorText && msg.stream_status === "failed" ? (
            <p className="whitespace-pre-wrap text-destructive">{errorText}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {msg.tool_status && (
                <p className="mb-2 text-xs text-muted-foreground">{msg.tool_status}</p>
              )}
              {msg.tool_reads && msg.tool_reads.length > 0 && (
                <details className="mb-2 text-xs text-muted-foreground">
                  <summary>{t("chat.tool_reads_label")}</summary>
                  <ul className="mt-1 space-y-0.5">
                    {msg.tool_reads.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </details>
              )}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
          {isFailed && (
            <div className="mt-2 space-y-1 border-t border-destructive/20 pt-2">
              {msg.stream_status === "incomplete" && errorText && (
                <p className="text-xs text-destructive">{errorText}</p>
              )}
              {showRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={sessionBusy}
                  onClick={() => onRetry(msg.id)}
                >
                  <RotateCcw className="size-3" />
                  {t("chat.retry")}
                </Button>
              )}
            </div>
          )}
        </div>
        {showActionBar && (
          <div className="flex items-center gap-1 px-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {copyText && (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                title={copied ? t("chat.copied") : t("chat.copy")}
                aria-label={copied ? t("chat.copied") : t("chat.copy")}
                onClick={(e) => void handleCopy(e)}
              >
                <Copy className={`size-3.5 ${copied ? "text-green-600" : ""}`} />
              </button>
            )}
            {!isUser && onDebug && (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                title={t("chat.debug_prompt")}
                aria-label={t("chat.debug_prompt")}
                onClick={() => onDebug(msg.id)}
              >
                <Bug className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className={`rounded p-1 transition-colors ${
                isExcluded
                  ? "text-orange-500"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={isExcluded ? t("chat.excluded_from_archive") : t("chat.exclude_from_archive")}
              aria-label={isExcluded ? t("chat.excluded_from_archive") : t("chat.exclude_from_archive")}
              onClick={() => onToggleExclude(msg.id)}
            >
              <CircleOff className="size-3.5" />
            </button>
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
    sessionMode,
    showToast,
    settings,
    instances,
    currentModels,
    activeSessionId,
    sessions,
    documents,
    ensureIngestSession,
    sendSessionMessage,
    retrySessionMessage,
    cancelStream,
    toggleMessageExclude,
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

  const t = useT()

  const [input, setInput] = useState("")
  const [wikiRefs, setWikiRefs] = useState<WikiRefPayload[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTitle, setArchiveTitle] = useState("")
  const [pendingReviewId, setPendingReviewId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [configLoaded, setConfigLoaded] = useState(false)
  const [debugMessageId, setDebugMessageId] = useState<string | null>(null)
  const [copyAllCopied, setCopyAllCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copyAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void (async () => {
      try {
        await Promise.all([
          ensureIngestSession(),
          loadInstances(),
          loadSettings(),
          listSessions(),
        ])
      } finally {
        setConfigLoaded(true)
      }
      void loadCapabilities()
      void refreshIngestJobs()
    })()
  }, [
    ensureIngestSession,
    loadCapabilities,
    refreshIngestJobs,
    loadInstances,
    loadSettings,
    listSessions,
  ])

  useEffect(
    () => () => {
      if (copyAllTimerRef.current) clearTimeout(copyAllTimerRef.current)
    },
    [],
  )

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

  const activeSession = sessions.find(
    (s) => s.id === (activeSessionId ?? sessionId),
  )
  const sessionTitle =
    activeSession?.title.trim() || "Untitled"

  const effectiveInstanceId =
    selectedInstanceId ||
    activeSession?.llm_instance_id ||
    settings?.last_instance_id ||
    ""
  const effectiveModel =
    selectedModel ||
    activeSession?.llm_model ||
    settings?.last_model ||
    ""

  const isReady =
    !!sessionId && !!effectiveInstanceId && !!effectiveModel

  const selectedInstance = instances.find(
    (i) => i.id === effectiveInstanceId,
  )
  const selectedModelInfo = currentModels.find(
    (m) => m.model_id === effectiveModel,
  )

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

  const hasPersistedUserMessage = sessionMessages.some(
    (m) => m.role === "user" && !m.id.startsWith("temp-"),
  )
  const sessionArchived = activeSession?.status === "archived"
  const archiveDisabled =
    sessionBusy || !hasPersistedUserMessage || !sessionId || sessionArchived
  const archiveDisabledReason = sessionArchived
    ? t("chat.archive_already_archived")
    : !hasPersistedUserMessage
      ? t("chat.archive_requires_user")
      : undefined

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sessionBusy || !isReady) return
    setInput("")
    const refs = wikiRefs
    setWikiRefs([])
    await sendSessionMessage(text, refs)
  }

  const handleRetry = useCallback(
    (assistantMessageId: string) => {
      if (!assistantMessageId || sessionBusy || !isReady) return
      void retrySessionMessage(assistantMessageId)
    },
    [sessionBusy, isReady, retrySessionMessage],
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
    try {
      const reviewId = await archiveSession(archiveTitle || undefined)
      setPendingReviewId(reviewId)
      showToast(t("chat.archive_review_hint"))
      setArchiveOpen(false)
    } catch {
      // archiveSession 已通过 sessionError → 全局 toast 展示错误
    }
  }

  const textareaDisabled = !sessionId || !isReady
  const sendDisabled =
    sessionBusy || textareaDisabled || !input.trim()
  const attachDisabled = sessionBusy || textareaDisabled
  const showCopyAll = hasCopyableSessionMessages(sessionMessages)

  const handleCopyAll = async () => {
    const text = formatSessionMessagesForCopy(sessionMessages, {
      user: t("chat.copy_role_user"),
      assistant: t("chat.copy_role_assistant"),
      attachment: t("chat.copy_attachment_label"),
    })
    if (!text) return
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    if (copyAllTimerRef.current) clearTimeout(copyAllTimerRef.current)
    setCopyAllCopied(true)
    copyAllTimerRef.current = setTimeout(() => setCopyAllCopied(false), 2000)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70"
        data-testid="ingest-message-panel"
      >
        {showCopyAll && (
          <div className="flex shrink-0 items-center justify-end border-b border-border/50 px-2 py-1.5 sm:px-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              title={copyAllCopied ? t("chat.copied") : t("chat.copy_all")}
              aria-label={copyAllCopied ? t("chat.copied") : t("chat.copy_all")}
              onClick={() => void handleCopyAll()}
            >
              <Copy className={`size-3.5 ${copyAllCopied ? "text-green-600" : ""}`} />
              {copyAllCopied ? t("chat.copied") : t("chat.copy_all")}
            </button>
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <div className="w-full space-y-4 px-2 py-4 sm:px-3">
            {configLoaded && !isReady && (
              <div className="rounded-lg bg-amber-50 py-8 text-center text-amber-600 dark:bg-amber-950/20">
                <p className="text-sm">
                  {instances.length === 0
                    ? t("chat.no_provider")
                    : !effectiveInstanceId || !effectiveModel
                      ? t("chat.select_model_hint")
                      : "..."}
                </p>
              </div>
            )}
            {sessionMessages.length === 0 && isReady && (
              <div className="py-16 text-center text-muted-foreground">
                <p className="mb-2 text-lg">{t("chat.start_topic")}</p>
                <p className="text-sm">
                  {t("chat.archive_desc")}
                </p>
              </div>
            )}
            {sessionMessages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                onRetry={handleRetry}
                onToggleExclude={toggleMessageExclude}
                onDebug={(id) => setDebugMessageId(id)}
                sessionBusy={sessionBusy}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      {pendingReviewId && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm dark:border-green-900 dark:bg-green-950/30">
          <span>{t("chat.archive_review_ready")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigateTo(workbenchViewHref("review"))
              setPendingReviewId(null)
            }}
          >
            {t("chat.go_to_review")}
          </Button>
        </div>
      )}

      {archiveOpen && (
        <div className="mb-2 space-y-3 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">{t("chat.confirm_archive")}</p>
          <Input
            placeholder={t("chat.session_title_optional")}
            value={archiveTitle}
            onChange={(e) => setArchiveTitle(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveOpen(false)}
            >
              {t("chat.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={sessionBusy}
              onClick={() => void handleArchive()}
            >
              {t("chat.confirm")}
            </Button>
          </div>
        </div>
      )}

      <div
        className={`mb-2 rounded-xl border p-2 ${
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
        {sessionId && (
          <div className="mb-1 flex items-center justify-between gap-2 px-2 pt-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={sessionTitle}>
              {sessionTitle}
            </span>
            {sessionMode === "qa" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <Lightbulb className="size-3" />
                {t("session.mode_qa")}
              </span>
            )}
            {sessionMode === "organize" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                <Wrench className="size-3" />
                {t("session.mode_organize")}
              </span>
            )}
            {(selectedInstance || effectiveModel) && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {selectedInstance && (
                  <span className="inline-flex items-center gap-1">
                    <Bot className="size-3" />
                    {selectedInstance.name}
                  </span>
                )}
                {effectiveModel && (
                  <span className="inline-flex items-center gap-1">
                    <Cpu className="size-3" />
                    {selectedModelInfo?.name ?? effectiveModel}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <WikiMentionPicker
          value={wikiRefs}
          onChange={setWikiRefs}
          disabled={textareaDisabled}
          documents={documents}
          textareaRef={textareaRef}
          inputValue={input}
          onInputChange={setInput}
        />
        <textarea
          ref={textareaRef}
          className="max-h-40 min-h-[72px] w-full resize-y bg-transparent px-2 py-2 text-sm outline-none"
          placeholder={
            !isReady
              ? t("chat.select_model_start")
              : t("chat.input_placeholder")
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={textareaDisabled}
        />
        <div className="flex items-center gap-2 pt-1">
          <SessionControls />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModelDialogOpen(true)}
            title={t("chat.model")}
          >
            <SlidersHorizontal className="size-3.5" />
            {t("chat.model")}
          </Button>
          <Button
            size="sm"
            disabled={archiveDisabled}
            onClick={() => setArchiveOpen(true)}
            title={archiveDisabledReason}
          >
            <Archive className="size-3.5" />
            {t("chat.archive")}
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            disabled={attachDisabled}
            onClick={() => fileRef.current?.click()}
            title={t("chat.attachment")}
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
            variant={sessionBusy ? "destructive" : "secondary"}
            disabled={sessionBusy ? false : sendDisabled}
            onClick={sessionBusy ? cancelStream : () => void handleSend()}
          >
            {sessionBusy ? (
              <Square className="size-3.5" />
            ) : (
              <Send className="size-3.5" />
            )}
            {sessionBusy ? t("chat.stop") : t("chat.send")}
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
        lastUsedInstanceId={settings?.last_instance_id}
        lastUsedModel={settings?.last_model}
        onLoadModels={handleLoadModels}
        onConfirm={(instanceId, modelId) => void handleModelConfirm(instanceId, modelId)}
      />

      <MessageDebugDialog
        open={!!debugMessageId}
        onOpenChange={(open) => { if (!open) setDebugMessageId(null) }}
        sessionId={sessionId}
        message={debugMessageId ? sessionMessages.find(m => m.id === debugMessageId) ?? null : null}
      />

    </div>
  )
}
