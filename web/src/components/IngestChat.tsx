import { useCallback, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useApp } from "@/context/AppContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { IngestSessionMessage } from "@/types"
import { Archive, Loader2, Paperclip, Send } from "lucide-react"

function MessageBubble({ msg }: { msg: IngestSessionMessage }) {
  const isUser = msg.role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : msg.message_type === "attachment_summary"
              ? "bg-muted border border-dashed"
              : "bg-muted"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content || (msg.stream_status === "streaming" ? "…" : "")}
            </ReactMarkdown>
          </div>
        )}
        {msg.stream_status === "failed" && (
          <p className="text-xs text-destructive mt-1">回复失败</p>
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
    ensureIngestSession,
    sendSessionMessage,
    uploadSessionAttachment,
    archiveSession,
    refreshIngestJobs,
    loadCapabilities,
  } = useApp()

  const [input, setInput] = useState("")
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTitle, setArchiveTitle] = useState("")
  const [archiveResult, setArchiveResult] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void ensureIngestSession()
    void loadCapabilities()
    void refreshIngestJobs()
  }, [ensureIngestSession, loadCapabilities, refreshIngestJobs])

  useEffect(() => {
    const el = bottomRef.current
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" })
    }
  }, [sessionMessages])

  const hasUserMessage = sessionMessages.some((m) => m.role === "user")

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sessionBusy) return
    setInput("")
    await sendSessionMessage(text)
  }

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

  return (
    <div className="flex flex-1 flex-col min-h-0 max-w-3xl mx-auto w-full">
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-4 pb-4">
          {sessionMessages.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-lg mb-2">开始一个话题</p>
              <p className="text-sm">
                与助手多轮对话探索清楚后，点击「归档」写入 wiki
              </p>
            </div>
          )}
          {sessionMessages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {sessionError && (
        <p className="px-4 text-sm text-destructive">{sessionError}</p>
      )}
      {archiveResult && (
        <p className="px-4 text-sm text-green-600">
          已提交归档任务：{archiveResult}
        </p>
      )}

      {archiveOpen && (
        <div className="mx-4 mb-2 p-4 border rounded-lg bg-card space-y-3">
          <p className="text-sm font-medium">确认归档</p>
          <Input
            placeholder="会话标题（可选）"
            value={archiveTitle}
            onChange={(e) => setArchiveTitle(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={sessionBusy} onClick={() => void handleArchive()}>
              确认归档
            </Button>
          </div>
        </div>
      )}

      <div
        className={`mx-4 mb-4 rounded-xl border p-2 ${
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
        <textarea
          className="w-full min-h-[72px] max-h-40 resize-y bg-transparent px-2 py-2 text-sm outline-none"
          placeholder="输入消息…（Shift+Enter 换行）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sessionBusy || !sessionId}
        />
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={sessionBusy || !sessionId}
            onClick={() => fileRef.current?.click()}
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
            disabled={sessionBusy || !input.trim() || !sessionId}
            onClick={() => void handleSend()}
          >
            {sessionBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            发送
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={sessionBusy || !hasUserMessage || !sessionId}
            onClick={() => setArchiveOpen(true)}
            title={!hasUserMessage ? "至少需要一条用户消息" : undefined}
          >
            <Archive className="size-3.5" />
            归档
          </Button>
        </div>
      </div>
    </div>
  )
}
