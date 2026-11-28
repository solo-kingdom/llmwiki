import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, CheckCircle2Icon, SendIcon } from "lucide-react"
import { AppLink } from "@/components/blocks/router"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { notify } from "@/components/blocks/notify"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Actions, Inline, Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useApp } from "@/context/app-context"
import { checkMCPStatus, testHelaNotification } from "@/lib/api"
import type { HelaNotifyTestResult, Settings } from "@/types"
import { JsonDialog, SettingRow, useSettingsSave } from "./shared"

const HELA_EVENT_OPTIONS = [
  { key: "ingest_failed", label: "摄入失败（ingest_failed）", description: "摄入、回滚或审阅执行失败时通知" },
  { key: "review_required", label: "转入审阅（review_required）", description: "新增页面超过直写阈值需人工确认时通知" },
  { key: "server_error", label: "服务端告警（server_error）", description: "索引重建失败、心跳超时重排或会话流异常时通知" },
] as const

function parseEventsSet(raw?: string): Set<string> {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return new Set(HELA_EVENT_OPTIONS.map((item) => item.key))
  if (trimmed.toLowerCase() === "none") return new Set()
  return new Set(
    trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function formatEventsSet(selected: Set<string>): string {
  const ordered = HELA_EVENT_OPTIONS.map((item) => item.key).filter((key) => selected.has(key))
  return ordered.length > 0 ? ordered.join(",") : "none"
}

export function IntegrationsSection() {
  const { settings, acpAgents } = useApp()
  const save = useSettingsSave()
  const [mcpDraft, setMcpDraft] = React.useState<string | null>(null)
  const [mcpChecks, setMcpChecks] = React.useState<{ id: string; name: string; status: string; message?: string }[]>([])
  if (settings === undefined) return <RowsSkeleton rows={6} />

  const mcpJson = mcpDraft ?? settings.mcp_servers_json ?? ""

  return (
    <Stack gap="lg">
      <HelaNotifySection settings={settings} />

      <Section size="lg" gap="lg" title="MCP 配置" description="为摄入任务提供外部工具。">
        <Panel padding="none">
          <Rows label="MCP 配置">
            <SettingRow
              label="MCP servers JSON"
              description={mcpChecks.length > 0 ? `${mcpChecks.length} 个 server 已检查` : "未检查"}
              control={
                <JsonDialog
                  title="MCP servers JSON"
                  description="保存后对新会话生效。"
                  value={mcpJson}
                  onChange={setMcpDraft}
                  onSave={() => { save.mutate({ mcp_servers_json: mcpJson }); setMcpDraft(null) }}
                  onCheck={() => void checkMCPStatus(mcpJson).then((result) => setMcpChecks(result.servers)).catch((error) => notify.error(error, "MCP 检查失败"))}
                  checkResult={
                    mcpChecks.length === 0 ? null : (
                      <Stack gap="sm">
                        {mcpChecks.map((server) => (
                          <Row key={server.id}>
                            <span className="min-w-0 flex-1 truncate text-sm">{server.name || server.id}</span>
                            <StatusBadge status={server.status} />
                          </Row>
                        ))}
                      </Stack>
                    )
                  }
                />
              }
            />
          </Rows>
        </Panel>
      </Section>

      <Section size="lg" gap="lg" title="ACP Agent" description="外部 coding agent 已统一收口到「模型与 Harness」设置。">
        <Panel padding="none">
          <Rows label="ACP Agent">
            <SettingRow
              label="ACP 配置入口"
              description={`${acpAgents.length} 个已配置；支持在模型与 Harness 设置中管理与探测。`}
              control={<Button size="sm" variant="outline" asChild><AppLink to="/settings/models">前往模型与 Harness 设置</AppLink></Button>}
            />
          </Rows>
        </Panel>
      </Section>
    </Stack>
  )
}

function HelaNotifySection({ settings }: { settings: Settings }) {
  const save = useSettingsSave()
  const [baseUrl, setBaseUrl] = React.useState(settings.hela_notify_base_url ?? "")
  const [apiKey, setApiKey] = React.useState("")
  const [testResult, setTestResult] = React.useState<HelaNotifyTestResult | null>(null)

  React.useEffect(() => {
    setBaseUrl(settings.hela_notify_base_url ?? "")
  }, [settings.hela_notify_base_url])

  const selectedEvents = React.useMemo(
    () => parseEventsSet(settings.hela_notify_events),
    [settings.hela_notify_events],
  )

  const testMut = useMutation({
    mutationFn: () =>
      testHelaNotification({
        hela_notify_base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { hela_notify_api_key: apiKey.trim() } : {}),
      }),
    onSuccess: (res) => {
      setTestResult(res)
      if (res.ok) notify.success(res.message)
      else notify.error(new Error(res.message), "Hela 测试通知发送失败")
    },
    onError: (err: Error) => notify.error(err, "Hela 测试通知发送失败"),
  })

  const sourceLabel =
    settings.hela_notify_source === "settings"
      ? "当前生效：系统设置"
      : settings.hela_notify_source === "env"
        ? "当前生效：环境变量兜底"
        : "当前未配置（可使用系统设置或 LLMWIKI_HELA_API_* 环境变量）"

  return (
    <Section
      size="lg"
      gap="lg"
      title="Hela 通知"
      description="在摄入失败、转入人工审阅或关键服务端异常时，异步推送 Markdown 告警到 Hela。"
    >
      <Panel padding="none">
        <Rows label="Hela 通知">
          <SettingRow
            label="启用 Hela 通知"
            description={sourceLabel}
            control={
              <Switch
                aria-label="启用 Hela 通知"
                checked={Boolean(settings.hela_notify_enabled)}
                onCheckedChange={(checked) => save.mutate({ hela_notify_enabled: checked })}
              />
            }
          />
          <SettingRow
            label="Hela API Base URL"
            description={
              settings.hela_notify_base_url_effective && !settings.hela_notify_base_url
                ? `环境变量生效中：${settings.hela_notify_base_url_effective}`
                : "例如 http://hela.example.com"
            }
            control={
              <Input
                aria-label="Hela API Base URL"
                className="w-64 max-sm:w-full"
                placeholder={settings.hela_notify_base_url_effective || "http://hela.example.com"}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => {
                  const trimmed = baseUrl.trim()
                  if (trimmed !== (settings.hela_notify_base_url ?? "")) {
                    save.mutate({ hela_notify_base_url: trimmed })
                  }
                }}
              />
            }
          />
          <SettingRow
            label="Hela API Key"
            description={
              settings.hela_notify_api_key_set
                ? `已配置（${settings.hela_notify_api_key_masked || "已掩码"}）`
                : "尚未配置"
            }
            control={
              <Input
                aria-label="Hela API Key"
                type="password"
                className="w-64 max-sm:w-full"
                placeholder={settings.hela_notify_api_key_set ? "留空保持不变" : "输入 Hela API Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={() => {
                  if (apiKey.trim()) {
                    save.mutate({ hela_notify_api_key: apiKey.trim() })
                    setApiKey("")
                  }
                }}
              />
            }
          />
          {HELA_EVENT_OPTIONS.map((item) => (
            <SettingRow
              key={item.key}
              label={item.label}
              description={item.description}
              control={
                <Switch
                  aria-label={item.label}
                  checked={selectedEvents.has(item.key)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedEvents)
                    if (checked) next.add(item.key)
                    else next.delete(item.key)
                    save.mutate({ hela_notify_events: formatEventsSet(next) })
                  }}
                />
              }
            />
          ))}
        </Rows>
      </Panel>

      <Actions align="start">
        <Button
          variant="outline"
          disabled={testMut.isPending}
          onClick={() => testMut.mutate()}
        >
          <SendIcon />
          {testMut.isPending ? "发送中…" : "发送测试通知"}
        </Button>
        {testResult ? (
          <Inline gap="sm">
            {testResult.ok ? (
              <CheckCircle2Icon className="size-4 text-primary" />
            ) : (
              <AlertCircleIcon className="size-4 text-destructive" />
            )}
            <span className="text-xs text-muted-foreground">
              {testResult.target ? `${testResult.target} — ` : ""}
              {testResult.message}
            </span>
          </Inline>
        ) : null}
      </Actions>
    </Section>
  )
}
