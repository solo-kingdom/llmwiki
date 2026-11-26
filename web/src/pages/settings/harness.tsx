import * as React from "react"
import { notify } from "@/components/blocks/notify"
import { RowsSkeleton } from "@/components/blocks/state-boundary"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Inline, Panel, Row, Rows, Section, Stack } from "@/components/blocks/surfaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApp } from "@/context/app-context"
import { checkACPAgents, checkHarness } from "@/lib/api"
import type {
  ACPAgentCheckResult,
  AgentKind,
  HarnessHealthCheckResult,
  HarnessPermissionMode,
  HarnixSettings,
} from "@/types"
import { JsonDialog, NumberSetting, SettingRow, useSettingsSave } from "./shared"

const DEFAULT_HARNIX_SETTINGS: HarnixSettings = {
  version: 1,
  defaultKind: "native",
  native: {
    maxTurns: 8,
    maxToolCalls: 32,
    maxToolCallsPerTurn: 4,
    timeoutMs: 180_000,
    includeUsage: true,
    permissionMode: "readonly",
  },
  pi: {
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 4_096,
    maxTurns: 8,
    maxToolCalls: 32,
    maxToolCallsPerTurn: 4,
    timeoutMs: 180_000,
    permissionMode: "readonly",
  },
  acp: {
    defaultAgentId: "",
    maxConcurrentSessions: 4,
    defaults: {
      readonlyOnly: true,
      onUnavailable: "error",
    },
    agents: {},
  },
}

const KIND_LABELS: Record<AgentKind, string> = {
  native: "Native",
  pi: "Pi AI",
  acp: "ACP",
}

function PermissionModeSelect({
  value,
  ariaLabel,
  onChange,
}: {
  value: HarnessPermissionMode
  ariaLabel: string
  onChange: (value: HarnessPermissionMode) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as HarnessPermissionMode)}>
      <SelectTrigger aria-label={ariaLabel} className="w-44 max-sm:w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="readonly">只读策略（默认）</SelectItem>
        <SelectItem value="allow_all">全部允许</SelectItem>
        <SelectItem value="deny_all">全部拒绝</SelectItem>
      </SelectContent>
    </Select>
  )
}

function ProbeResultInline({ result }: { result: HarnessHealthCheckResult | null }) {
  if (result === null) return null
  return (
    <Row>
      <StatusBadge status={result.status} />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">{result.message}</span>
    </Row>
  )
}

export function HarnessSection() {
  const { settings, acpAgents, harnessDescriptors } = useApp()
  const save = useSettingsSave()
  const [activeTab, setActiveTab] = React.useState<AgentKind>("native")
  const [acpDraft, setAcpDraft] = React.useState<string | null>(null)
  const [acpChecks, setAcpChecks] = React.useState<ACPAgentCheckResult[]>([])
  const [probeByKind, setProbeByKind] = React.useState<Partial<Record<AgentKind, HarnessHealthCheckResult>>>({})
  const [checkingKind, setCheckingKind] = React.useState<AgentKind | null>(null)

  if (settings === undefined) return <RowsSkeleton rows={8} />

  const current = settings.harnix_settings ?? DEFAULT_HARNIX_SETTINGS
  const acpJson = acpDraft ?? settings.acp_agents_json ?? ""
  const activeDescriptor = harnessDescriptors.find((d) => d.id === current.defaultKind)

  const saveHarness = (next: HarnixSettings) => {
    save.mutate({ harnix_settings: next })
  }

  const runProbe = async (kind: AgentKind) => {
    setCheckingKind(kind)
    try {
      const result = await checkHarness({ kind, harnix_settings: current })
      setProbeByKind((prev) => ({ ...prev, [kind]: result }))
      if (!result.ok) notify.error(new Error(result.message), `${KIND_LABELS[kind]} 检查未通过`)
    } catch (error) {
      notify.error(error, `${KIND_LABELS[kind]} 检查失败`)
    } finally {
      setCheckingKind(null)
    }
  }

  return (
    <>
      <Section size="lg" gap="lg" title="默认 Harness" description="选择新会话默认使用的 Agent 运行时实现，并查看能力支持。">
        <Panel padding="none">
          <Rows label="默认 Harness">
            <SettingRow
              label="默认实现"
              description={activeDescriptor?.summary ?? "在 Native、Pi AI 与 ACP 之间切换默认执行引擎。"}
              control={
                <Inline gap="sm">
                  <Select
                    value={current.defaultKind}
                    onValueChange={(value) => saveHarness({ ...current, defaultKind: value as AgentKind })}
                  >
                    <SelectTrigger aria-label="默认 Harness 实现" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="native">Native</SelectItem>
                      <SelectItem value="pi">Pi AI</SelectItem>
                      <SelectItem value="acp">ACP</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={checkingKind === current.defaultKind}
                    onClick={() => void runProbe(current.defaultKind)}
                  >
                    {checkingKind === current.defaultKind ? "检查中…" : "检查"}
                  </Button>
                </Inline>
              }
            />
            {activeDescriptor !== undefined ? (
              <SettingRow
                label="能力与依赖"
                description={activeDescriptor.requiresProvider ? "复用「模型」分区的 Provider 实例与模型" : "通过外部 CLI 与 stdio JSON-RPC 通信"}
                control={
                  <Inline gap="xs" wrap>
                    {activeDescriptor.capabilities.map((cap) => (
                      <Badge key={cap} variant="secondary">{cap}</Badge>
                    ))}
                  </Inline>
                }
              />
            ) : null}
            <ProbeResultInline result={probeByKind[current.defaultKind] ?? null} />
          </Rows>
        </Panel>
      </Section>

      <Section size="lg" gap="lg" title="分实现配置" description="按 Harness 实现维护各自独立的运行时参数、权限与外部 Agent。">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AgentKind)}>
          <TabsList>
            <TabsTrigger value="native">Native</TabsTrigger>
            <TabsTrigger value="pi">Pi AI</TabsTrigger>
            <TabsTrigger value="acp">ACP</TabsTrigger>
          </TabsList>

          <TabsContent value="native">
            <Panel padding="none">
              <Rows label="Native 配置">
                <SettingRow
                  label="工具权限策略"
                  description="控制 Native 运行时调用工具前的权限校验。"
                  control={
                    <PermissionModeSelect
                      ariaLabel="Native 工具权限策略"
                      value={current.native.permissionMode}
                      onChange={(permissionMode) =>
                        saveHarness({ ...current, native: { ...current.native, permissionMode } })
                      }
                    />
                  }
                />
                <NumberSetting
                  label="最大轮次"
                  description="单次对话最多执行的工具循环轮数（1–64）。"
                  value={current.native.maxTurns}
                  defaultValue={8}
                  onSave={(maxTurns) => saveHarness({ ...current, native: { ...current.native, maxTurns } })}
                />
                <NumberSetting
                  label="总工具调用上限"
                  description="单次运行累计允许调用工具的次数上限（1–256）。"
                  value={current.native.maxToolCalls}
                  defaultValue={32}
                  onSave={(maxToolCalls) => saveHarness({ ...current, native: { ...current.native, maxToolCalls } })}
                />
                <NumberSetting
                  label="单轮工具调用上限"
                  description="单轮最多执行的工具数量（1–32）。"
                  value={current.native.maxToolCallsPerTurn}
                  defaultValue={4}
                  onSave={(maxToolCallsPerTurn) =>
                    saveHarness({ ...current, native: { ...current.native, maxToolCallsPerTurn } })
                  }
                />
                <NumberSetting
                  label="超时时间 (ms)"
                  description="单次运行超时阈值（5000–3600000）。"
                  value={current.native.timeoutMs}
                  defaultValue={180_000}
                  onSave={(timeoutMs) => saveHarness({ ...current, native: { ...current.native, timeoutMs } })}
                />
                <SettingRow
                  label="请求 Token 用量"
                  description="OpenAI-compatible 请求携带 stream_options.include_usage。"
                  control={
                    <Switch
                      aria-label="Native 请求 Token 用量"
                      checked={current.native.includeUsage}
                      onCheckedChange={(includeUsage) =>
                        saveHarness({ ...current, native: { ...current.native, includeUsage } })
                      }
                    />
                  }
                />
                <SettingRow
                  label="Temperature 覆盖（可选）"
                  description="留空则沿用会话模式默认值（0–2）。"
                  control={
                    <Input
                      aria-label="Native Temperature"
                      className="w-32 max-sm:w-full"
                      type="number"
                      step="0.1"
                      placeholder="默认"
                      defaultValue={current.native.temperature === undefined ? "" : String(current.native.temperature)}
                      onBlur={(event) => {
                        const raw = event.target.value.trim()
                        if (raw === "") {
                          if (current.native.temperature !== undefined) {
                            const nextNative = { ...current.native }
                            delete nextNative.temperature
                            saveHarness({ ...current, native: nextNative })
                          }
                          return
                        }
                        const parsed = Number(raw)
                        if (Number.isFinite(parsed) && parsed !== current.native.temperature) {
                          saveHarness({ ...current, native: { ...current.native, temperature: parsed } })
                        }
                      }}
                    />
                  }
                />
                <SettingRow
                  label="连通性检查"
                  description="验证当前默认模型实例是否可用于 Native Harness。"
                  control={
                    <Button size="sm" variant="outline" disabled={checkingKind === "native"} onClick={() => void runProbe("native")}>
                      {checkingKind === "native" ? "检查中…" : "检查 Native"}
                    </Button>
                  }
                />
                <ProbeResultInline result={probeByKind.native ?? null} />
              </Rows>
            </Panel>
          </TabsContent>

          <TabsContent value="pi">
            <Panel padding="none">
              <Rows label="Pi AI 配置">
                <SettingRow
                  label="工具权限策略"
                  description="控制 Pi 运行时调用工具前的权限校验。"
                  control={
                    <PermissionModeSelect
                      ariaLabel="Pi 工具权限策略"
                      value={current.pi.permissionMode}
                      onChange={(permissionMode) =>
                        saveHarness({ ...current, pi: { ...current.pi, permissionMode } })
                      }
                    />
                  }
                />
                <SettingRow
                  label="启用 Reasoning"
                  description="向 Pi 模型路由开启思维链/推理输出。"
                  control={
                    <Switch
                      aria-label="Pi 启用 Reasoning"
                      checked={current.pi.reasoning}
                      onCheckedChange={(reasoning) => saveHarness({ ...current, pi: { ...current.pi, reasoning } })}
                    />
                  }
                />
                <NumberSetting
                  label="上下文窗口"
                  description="传给 Pi 模型路由的上下文窗口大小（1024–2000000）。"
                  value={current.pi.contextWindow}
                  defaultValue={128_000}
                  onSave={(contextWindow) => saveHarness({ ...current, pi: { ...current.pi, contextWindow } })}
                />
                <NumberSetting
                  label="Max Tokens"
                  description="单次响应最大输出 token（1–200000）。"
                  value={current.pi.maxTokens}
                  defaultValue={4_096}
                  onSave={(maxTokens) => saveHarness({ ...current, pi: { ...current.pi, maxTokens } })}
                />
                <NumberSetting
                  label="最大轮次"
                  description="单次对话最多执行的工具循环轮数（1–64）。"
                  value={current.pi.maxTurns}
                  defaultValue={8}
                  onSave={(maxTurns) => saveHarness({ ...current, pi: { ...current.pi, maxTurns } })}
                />
                <NumberSetting
                  label="总工具调用上限"
                  description="单次运行累计允许调用工具的次数上限（1–256）。"
                  value={current.pi.maxToolCalls}
                  defaultValue={32}
                  onSave={(maxToolCalls) => saveHarness({ ...current, pi: { ...current.pi, maxToolCalls } })}
                />
                <NumberSetting
                  label="单轮工具调用上限"
                  description="单轮最多执行的工具数量（1–32）。"
                  value={current.pi.maxToolCallsPerTurn}
                  defaultValue={4}
                  onSave={(maxToolCallsPerTurn) =>
                    saveHarness({ ...current, pi: { ...current.pi, maxToolCallsPerTurn } })
                  }
                />
                <NumberSetting
                  label="超时时间 (ms)"
                  description="单次运行超时阈值（5000–3600000）。"
                  value={current.pi.timeoutMs}
                  defaultValue={180_000}
                  onSave={(timeoutMs) => saveHarness({ ...current, pi: { ...current.pi, timeoutMs } })}
                />
                <SettingRow
                  label="连通性检查"
                  description="验证当前默认模型实例是否可用于 Pi AI Harness。"
                  control={
                    <Button size="sm" variant="outline" disabled={checkingKind === "pi"} onClick={() => void runProbe("pi")}>
                      {checkingKind === "pi" ? "检查中…" : "检查 Pi"}
                    </Button>
                  }
                />
                <ProbeResultInline result={probeByKind.pi ?? null} />
              </Rows>
            </Panel>
          </TabsContent>

          <TabsContent value="acp">
            <Panel padding="none">
              <Rows label="ACP 配置">
                <SettingRow
                  label="默认 ACP Agent"
                  description={`${acpAgents.filter((agent) => agent.enabled).length} 个已启用`}
                  control={
                    <Select
                      value={current.acp.defaultAgentId || ""}
                      onValueChange={(defaultAgentId) =>
                        saveHarness({ ...current, acp: { ...current.acp, defaultAgentId } })
                      }
                    >
                      <SelectTrigger aria-label="默认 ACP Agent" className="w-44 max-sm:w-full">
                        <SelectValue placeholder="未选择" />
                      </SelectTrigger>
                      <SelectContent>
                        {acpAgents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <NumberSetting
                  label="最大并发进程数"
                  description="同时保持活跃的 ACP 子进程会话上限（1–16）。"
                  value={current.acp.maxConcurrentSessions}
                  defaultValue={4}
                  onSave={(maxConcurrentSessions) =>
                    saveHarness({ ...current, acp: { ...current.acp, maxConcurrentSessions } })
                  }
                />
                <SettingRow
                  label="全局只读限制"
                  description="开启后禁止任何 ACP Agent 授予 write / execute 权限。"
                  control={
                    <Switch
                      aria-label="ACP 全局只读限制"
                      checked={current.acp.defaults.readonlyOnly}
                      onCheckedChange={(readonlyOnly) =>
                        saveHarness({
                          ...current,
                          acp: {
                            ...current.acp,
                            defaults: { ...current.acp.defaults, readonlyOnly },
                          },
                        })
                      }
                    />
                  }
                />
                <SettingRow
                  label="ACP Agents JSON"
                  description={`${acpAgents.length} 个已配置；仅声明 env_passthrough 变量名`}
                  control={
                    <JsonDialog
                      title="ACP agents JSON"
                      description="保存后对新会话生效；检查会探测命令与协议版本。"
                      value={acpJson}
                      onChange={setAcpDraft}
                      onSave={() => {
                        save.mutate({ acp_agents_json: acpJson })
                        setAcpDraft(null)
                      }}
                      onCheck={() =>
                        void checkACPAgents(acpJson)
                          .then((result) => setAcpChecks(result.agents))
                          .catch((error) => notify.error(error, "ACP 检查失败"))
                      }
                      checkResult={
                        acpChecks.length === 0 ? null : (
                          <Stack gap="sm">
                            {acpChecks.map((agent) => (
                              <Row key={agent.id}>
                                <span className="min-w-0 flex-1 truncate text-sm">{agent.name || agent.id}</span>
                                <StatusBadge status={agent.status} />
                              </Row>
                            ))}
                          </Stack>
                        )
                      }
                    />
                  }
                />
                <SettingRow
                  label="连通性检查"
                  description="探测所有已启用 ACP Agent 的可执行文件与握手协议。"
                  control={
                    <Button size="sm" variant="outline" disabled={checkingKind === "acp"} onClick={() => void runProbe("acp")}>
                      {checkingKind === "acp" ? "检查中…" : "检查 ACP"}
                    </Button>
                  }
                />
                <ProbeResultInline result={probeByKind.acp ?? null} />
              </Rows>
            </Panel>
          </TabsContent>
        </Tabs>
      </Section>
    </>
  )
}
