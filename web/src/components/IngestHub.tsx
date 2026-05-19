import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/context/AppContext"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "text-green-700"
      : status === "failed"
        ? "text-red-700"
        : status === "running"
          ? "text-blue-700"
          : "text-muted-foreground"
  return <span className={`text-xs font-medium ${cls}`}>{status}</span>
}

export function IngestHub() {
  const {
    ingestJobs,
    capabilities,
    refreshIngestJobs,
    submitConversation,
    submitText,
    submitUpload,
    retryIngest,
    cancelIngest,
    loadCapabilities,
  } = useApp()

  const [convTitle, setConvTitle] = useState("")
  const [convContent, setConvContent] = useState("")
  const [textTitle, setTextTitle] = useState("")
  const [textContent, setTextContent] = useState("")
  const [uploadResult, setUploadResult] = useState<string>("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    refreshIngestJobs()
    loadCapabilities()
    const t = setInterval(() => {
      refreshIngestJobs()
    }, 3000)
    return () => clearInterval(t)
  }, [refreshIngestJobs, loadCapabilities])

  const missingDeps = useMemo(() => {
    if (!capabilities) return []
    return capabilities.runtime_dependencies.filter((d) => !d.found)
  }, [capabilities])

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ingest Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">
          默认数据摄入入口：对话、文本、文件上传统一入队处理。
        </p>
      </div>

      {missingDeps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runtime Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {missingDeps.map((d) => (
              <p key={d.name}>
                <strong>{d.name}</strong> 未安装：{d.purpose}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">对话式摄入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="会话标题（可选）"
              value={convTitle}
              onChange={(e) => setConvTitle(e.target.value)}
            />
            <textarea
              className="w-full min-h-32 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
              placeholder="输入会话内容..."
              value={convContent}
              onChange={(e) => setConvContent(e.target.value)}
            />
            <Button
              disabled={busy || !convContent.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  await submitConversation({
                    title: convTitle,
                    content: convContent,
                  })
                  setConvContent("")
                } finally {
                  setBusy(false)
                }
              }}
            >
              提交会话摄入
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">文本提交摄入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="文本标题（可选）"
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
            />
            <textarea
              className="w-full min-h-32 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
              placeholder="粘贴文本或 Markdown..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
            />
            <Button
              disabled={busy || !textContent.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  await submitText({
                    title: textTitle,
                    content: textContent,
                  })
                  setTextContent("")
                } finally {
                  setBusy(false)
                }
              }}
            >
              提交文本摄入
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">文件上传摄入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="file"
              multiple
              onChange={async (e) => {
                const files = Array.from(e.target.files || [])
                if (files.length === 0) return
                setBusy(true)
                try {
                  const result = await submitUpload(files)
                  setUploadResult(
                    `accepted: ${result.accepted.length}, rejected: ${result.rejected.length}`,
                  )
                } finally {
                  setBusy(false)
                }
              }}
            />
            {uploadResult && (
              <p className="text-xs text-muted-foreground">{uploadResult}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ingestJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无摄入任务</p>
          )}
          {ingestJobs.map((job) => (
            <div
              key={job.id}
              className="border rounded-lg px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{job.source_path}</p>
                <p className="text-xs text-muted-foreground">
                  {job.input_type} · {new Date(job.created_at).toLocaleString()}
                </p>
                {(job.error_message || job.remediation) && (
                  <p className="text-xs text-red-700 mt-1">
                    {job.error_message || job.error}
                    {job.remediation ? `（${job.remediation}）` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={job.status} />
                {job.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => retryIngest(job.id)}>
                    Retry
                  </Button>
                )}
                {(job.status === "queued" || job.status === "running") && (
                  <Button size="sm" variant="outline" onClick={() => cancelIngest(job.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
