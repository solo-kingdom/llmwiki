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
import { useApp } from "@/context/app-context"
import { checkACPAgents, checkHarness } from "@/lib/api"
import {
  applyHarnessModelBinding,
  buildSwitchHarnessPatch,
  DEFAULT_HARNIX_SETTINGS,
  resolveHarnessAdapterHint,
  resolveHarnessModelBinding,
} from "@/lib/harness-settings"
import { resolveLinkedModelSelection } from "@/lib/instance-models"
import type {
  ACPAgentCheckResult,
  AgentKind,
  HarnessHealthCheckResult,
  HarnessPermissionMode,
  HarnixSettings,
  Settings,
} from "@/types"
import { JsonDialog, SettingRow, useCatalogModelNames, useSettingsSave } from "./shared"

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

function HarnessNumberSetting({
  fieldKey,
  label,
  description,
  value,
  placeholder,
  step = "1",
  pendingInputs,
  onDraftChange,
  onCommit,
}: {
  fieldKey: string
  label: string
  description: string
  value: number | undefined
  placeholder: string
  step?: string
  pendingInputs: Readonly<Record<string, string>>
  onDraftChange: (key: string, next: string) => void
  onCommit: (raw: string) => void
}) {
  const display =
    fieldKey in pendingInputs
      ? (pendingInputs[fieldKey] ?? "")
      : (value === undefined ? "" : String(value))

  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Input
          className="w-32 max-sm:w-full"
          type="number"
          step={step}
          aria-label={label}
          placeholder={placeholder}
          value={display}
          onChange={(event) => onDraftChange(fieldKey, event.target.value)}
          onBlur={() => onCommit(display)}
        />
      }
    />
  )
}

function ProviderModelBindingRows({
  kind,
  settings,
  draft,
  onApplyPatch,
}: {
  kind: "native" | "pi"
  settings: Settings
  draft: HarnixSettings
  onApplyPatch: (patch: Partial<Settings>, nextSettings: HarnixSettings) => void
}) {
  const { instances } = useApp()
  const binding = resolveHarnessModelBinding(
    kind,
    draft,
    settings.last_instance_id,
    settings.last_model,
    instances,
  )
  const catalogNames = useCatalogModelNames(binding.instance?.catalog_id)
  const kindLabel = KIND_LABELS[kind]
  const adapterHint = resolveHarnessAdapterHint(kind, binding.instance, binding.missingInstance)

  return (
    <>
      <SettingRow
        label="对话 Provider 实例"
        description={adapterHint}
        control={
          <Select
            value={binding.instanceId}
            disabled={instances.length === 0}
            onValueChange={(nextId) => {
              const nextModel = resolveLinkedModelSelection(
                instances,
                nextId,
                binding.model || settings.last_model,
              )
              const patch = applyHarnessModelBinding(draft, kind, nextId, nextModel)
              if (patch.harnix_settings) {
                onApplyPatch(patch, patch.harnix_settings)
              }
            }}
          >
            <SelectTrigger aria-label={`${kindLabel} Provider 实例`} className="w-56 max-sm:w-full">
              <SelectValue placeholder={instances.length === 0 ? "请先添加实例" : "选择实例"} />
            </SelectTrigger>
            <SelectContent>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingRow
        label="对话模型"
        description={
          binding.instance && binding.availableModels.length === 0
            ? "当前实例尚未选择模型，请在上方编辑该实例"
            : `仅保存为 ${kindLabel} 的默认模型；切换至其他 Harness 后再切回仍会保留`
        }
        control={
          <Select
            value={binding.model}
            disabled={!binding.instance || binding.availableModels.length === 0}
            onValueChange={(nextModel) => {
              if (!binding.instance) return
              const patch = applyHarnessModelBinding(draft, kind, binding.instance.id, nextModel)
              if (patch.harnix_settings) {
                onApplyPatch(patch, patch.harnix_settings)
              }
            }}
          >
            <SelectTrigger aria-label={`${kindLabel} 对话模型`} className="w-56 max-sm:w-full">
              <SelectValue
                placeholder={
                  binding.instance && binding.availableModels.length === 0
                    ? "实例未选模型"
                    : "选择模型"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {binding.availableModels.map((modelId) => {
                const label = catalogNames.get(modelId)
                return (
                  <SelectItem key={modelId} value={modelId}>
                    {label && label !== modelId ? `${label} (${modelId})` : modelId}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        }
      />
    </>
  )
}

export function HarnessRuntimeSection() {
  const { settings, instances, acpAgents, harnessDescriptors } = useApp()
  const save = useSettingsSave()
  const [optimisticDraft, setOptimisticDraft] = React.useState<{
    base: HarnixSettings | undefined
    value: HarnixSettings
  } | null>(null)
  const [pendingInputs, setPendingInputs] = React.useState<Record<string, string>>({})
  const [acpDraft, setAcpDraft] = React.useState<string | null>(null)
  const [acpChecks, setAcpChecks] = React.useState<ACPAgentCheckResult[]>([])
  const [probeByKind, setProbeByKind] = React.useState<Partial<Record<AgentKind, HarnessHealthCheckResult>>>({})
  const [checkingKind, setCheckingKind] = React.useState<AgentKind | null>(null)

  if (settings === undefined) return <RowsSkeleton rows={8} />

  const serverHarness = settings.harnix_settings
  const current =
    optimisticDraft !== null && optimisticDraft.base === serverHarness
      ? optimisticDraft.value
      : (serverHarness ?? DEFAULT_HARNIX_SETTINGS)
  const activeKind = current.defaultKind
  const activeDescriptor = harnessDescriptors.find((d) => d.id === activeKind)
  const acpJson = acpDraft ?? settings.acp_agents_json ?? ""

  const updateDraftField = (key: string, nextValue: string) => {
    setPendingInputs((prev) => ({ ...prev, [key]: nextValue }))
  }

  const clearDraftKey = (key: string) => {
    setPendingInputs((prev) => {
      if (!(key in prev)) return prev
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
  }

  const commitHarness = (next: HarnixSettings, patch?: Partial<Settings>) => {
    setOptimisticDraft({ base: serverHarness, value: next })
    save.mutate(patch ?? { harnix_settings: next })
  }

  const handleSwitchKind = (nextKind: AgentKind) => {
    if (nextKind === activeKind) return
    const patch = buildSwitchHarnessPatch(current, nextKind, pendingInputs, instances)
    setPendingInputs({})
    if (patch.harnix_settings) {
      setOptimisticDraft({ base: serverHarness, value: patch.harnix_settings })
    }
    save.mutate(patch)
  }

  const runProbe = async (kind: AgentKind) => {
    setCheckingKind(kind)
    try {
      const binding = resolveHarnessModelBinding(
        kind,
        current,
        settings.last_instance_id,
        settings.last_model,
        instances,
      )
      const result = await checkHarness({
        kind,
        harnix_settings: current,
        ...(kind !== "acp" && binding.instanceId !== "" ? { instance_id: binding.instanceId } : {}),
        ...(kind !== "acp" && binding.model !== "" ? { model: binding.model } : {}),
        ...(kind === "acp" && current.acp.defaultAgentId !== ""
          ? { acp_agent_id: current.acp.defaultAgentId }
          : {}),
      })
      setProbeByKind((prev) => ({ ...prev, [kind]: result }))
      if (!result.ok) notify.error(new Error(result.message), `${KIND_LABELS[kind]} 检查未通过`)
    } catch (error) {
      notify.error(error, `${KIND_LABELS[kind]} 检查失败`)
    } finally {
      setCheckingKind(null)
    }
  }

  const commitRequiredInt = (
    fieldKey: string,
    currentVal: number,
    min: number,
    max: number,
    apply: (val: number) => HarnixSettings,
  ) => (raw: string) => {
    const trimmed = raw.trim()
    clearDraftKey(fieldKey)
    if (trimmed === "") return
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      notify.error(new Error(`请输入 ${min} 到 ${max} 之间的整数`), "参数范围无效")
      return
    }
    if (parsed !== currentVal) {
      commitHarness(apply(parsed))
    }
  }

  return (
    <Section
      size="lg"
      gap="lg"
      title="对话 Harness 与模型"
      description="选择对话运行时实现，仅展示当前选中实现的专属设置与绑定模型；切换实现时自动保留其余配置。"
    >
      <Panel padding="none">
        <Rows key={activeKind} label={`${KIND_LABELS[activeKind]} 配置`}>
          <SettingRow
            label="Harness 实现"
            description={activeDescriptor?.summary ?? "在 Native、Pi AI 与 ACP 之间切换对话执行引擎。"}
            control={
              <Inline gap="sm">
                <Select value={activeKind} onValueChange={(value) => handleSwitchKind(value as AgentKind)}>
                  <SelectTrigger aria-label="对话 Harness 实现" className="w-40">
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
                  disabled={checkingKind === activeKind}
                  onClick={() => void runProbe(activeKind)}
                >
                  {checkingKind === activeKind ? "检查中…" : `检查 ${KIND_LABELS[activeKind]}`}
                </Button>
              </Inline>
            }
          />
          {activeDescriptor !== undefined ? (
            <SettingRow
              label="能力与依赖"
              description={
                activeDescriptor.requiresProvider
                  ? "与下方绑定模型直接联动，可在对话页按会话切换"
                  : "通过外部 CLI 与 stdio JSON-RPC 通信，对话不依赖上方 Provider 实例"
              }
              control={
                <Inline gap="xs" wrap>
                  {activeDescriptor.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary">{cap}</Badge>
                  ))}
                </Inline>
              }
            />
          ) : null}
          <ProbeResultInline result={probeByKind[activeKind] ?? null} />

          {activeKind === "native" ? (
            <>
              <ProviderModelBindingRows
                kind="native"
                settings={settings}
                draft={current}
                onApplyPatch={(patch, nextSettings) => commitHarness(nextSettings, patch)}
              />
              <SettingRow
                label="工具权限策略"
                description="控制 Native 运行时调用工具前的权限校验。"
                control={
                  <PermissionModeSelect
                    ariaLabel="Native 工具权限策略"
                    value={current.native.permissionMode}
                    onChange={(permissionMode) =>
                      commitHarness({ ...current, native: { ...current.native, permissionMode } })
                    }
                  />
                }
              />
              <HarnessNumberSetting
                fieldKey="native.maxTurns"
                label="最大轮次"
                description="单次对话最多执行的工具循环轮数（1–64）。"
                value={current.native.maxTurns}
                placeholder="8"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("native.maxTurns", current.native.maxTurns, 1, 64, (maxTurns) => ({
                  ...current,
                  native: { ...current.native, maxTurns },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="native.maxToolCalls"
                label="总工具调用上限"
                description="单次运行累计允许调用工具的次数上限（1–256）。"
                value={current.native.maxToolCalls}
                placeholder="32"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("native.maxToolCalls", current.native.maxToolCalls, 1, 256, (maxToolCalls) => ({
                  ...current,
                  native: { ...current.native, maxToolCalls },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="native.maxToolCallsPerTurn"
                label="单轮工具调用上限"
                description="单轮最多执行的工具数量（1–32）。"
                value={current.native.maxToolCallsPerTurn}
                placeholder="4"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt(
                  "native.maxToolCallsPerTurn",
                  current.native.maxToolCallsPerTurn,
                  1,
                  32,
                  (maxToolCallsPerTurn) => ({
                    ...current,
                    native: { ...current.native, maxToolCallsPerTurn },
                  }),
                )}
              />
              <HarnessNumberSetting
                fieldKey="native.timeoutMs"
                label="超时时间 (ms)"
                description="单次运行超时阈值（5000–3600000）。"
                value={current.native.timeoutMs}
                placeholder="180000"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("native.timeoutMs", current.native.timeoutMs, 5_000, 3_600_000, (timeoutMs) => ({
                  ...current,
                  native: { ...current.native, timeoutMs },
                }))}
              />
              <SettingRow
                label="请求 Token 用量"
                description="OpenAI-compatible 请求携带 stream_options.include_usage。"
                control={
                  <Switch
                    aria-label="Native 请求 Token 用量"
                    checked={current.native.includeUsage}
                    onCheckedChange={(includeUsage) =>
                      commitHarness({ ...current, native: { ...current.native, includeUsage } })
                    }
                  />
                }
              />
              <HarnessNumberSetting
                fieldKey="native.temperature"
                label="Temperature 覆盖（可选）"
                description="留空则沿用会话模式默认值（0–2）。"
                value={current.native.temperature}
                placeholder="默认"
                step="0.1"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={(raw) => {
                  const trimmed = raw.trim()
                  clearDraftKey("native.temperature")
                  if (trimmed === "") {
                    if (current.native.temperature !== undefined) {
                      const nextNative = { ...current.native }
                      delete nextNative.temperature
                      commitHarness({ ...current, native: nextNative })
                    }
                    return
                  }
                  const parsed = Number(trimmed)
                  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
                    notify.error(new Error("Temperature 必须在 0 到 2 之间"), "参数范围无效")
                    return
                  }
                  if (parsed !== current.native.temperature) {
                    commitHarness({ ...current, native: { ...current.native, temperature: parsed } })
                  }
                }}
              />
              <HarnessNumberSetting
                fieldKey="native.maxTokens"
                label="Max Tokens 覆盖（可选）"
                description="留空则沿用会话模式默认值（1–200000）。"
                value={current.native.maxTokens}
                placeholder="默认"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={(raw) => {
                  const trimmed = raw.trim()
                  clearDraftKey("native.maxTokens")
                  if (trimmed === "") {
                    if (current.native.maxTokens !== undefined) {
                      const nextNative = { ...current.native }
                      delete nextNative.maxTokens
                      commitHarness({ ...current, native: nextNative })
                    }
                    return
                  }
                  const parsed = Number(trimmed)
                  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200_000) {
                    notify.error(new Error("Max Tokens 必须是 1 到 200000 的整数"), "参数范围无效")
                    return
                  }
                  if (parsed !== current.native.maxTokens) {
                    commitHarness({ ...current, native: { ...current.native, maxTokens: parsed } })
                  }
                }}
              />
            </>
          ) : null}

          {activeKind === "pi" ? (
            <>
              <ProviderModelBindingRows
                kind="pi"
                settings={settings}
                draft={current}
                onApplyPatch={(patch, nextSettings) => commitHarness(nextSettings, patch)}
              />
              <SettingRow
                label="工具权限策略"
                description="控制 Pi 运行时调用工具前的权限校验。"
                control={
                  <PermissionModeSelect
                    ariaLabel="Pi 工具权限策略"
                    value={current.pi.permissionMode}
                    onChange={(permissionMode) =>
                      commitHarness({ ...current, pi: { ...current.pi, permissionMode } })
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
                    onCheckedChange={(reasoning) =>
                      commitHarness({ ...current, pi: { ...current.pi, reasoning } })
                    }
                  />
                }
              />
              <HarnessNumberSetting
                fieldKey="pi.contextWindow"
                label="上下文窗口"
                description="传给 Pi 模型路由的上下文窗口大小（1024–2000000）。"
                value={current.pi.contextWindow}
                placeholder="128000"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("pi.contextWindow", current.pi.contextWindow, 1_024, 2_000_000, (contextWindow) => ({
                  ...current,
                  pi: { ...current.pi, contextWindow },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="pi.maxTokens"
                label="Max Tokens"
                description="单次响应最大输出 token（1–200000）。"
                value={current.pi.maxTokens}
                placeholder="4096"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("pi.maxTokens", current.pi.maxTokens, 1, 200_000, (maxTokens) => ({
                  ...current,
                  pi: { ...current.pi, maxTokens },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="pi.maxTurns"
                label="最大轮次"
                description="单次对话最多执行的工具循环轮数（1–64）。"
                value={current.pi.maxTurns}
                placeholder="8"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("pi.maxTurns", current.pi.maxTurns, 1, 64, (maxTurns) => ({
                  ...current,
                  pi: { ...current.pi, maxTurns },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="pi.maxToolCalls"
                label="总工具调用上限"
                description="单次运行累计允许调用工具的次数上限（1–256）。"
                value={current.pi.maxToolCalls}
                placeholder="32"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("pi.maxToolCalls", current.pi.maxToolCalls, 1, 256, (maxToolCalls) => ({
                  ...current,
                  pi: { ...current.pi, maxToolCalls },
                }))}
              />
              <HarnessNumberSetting
                fieldKey="pi.maxToolCallsPerTurn"
                label="单轮工具调用上限"
                description="单轮最多执行的工具数量（1–32）。"
                value={current.pi.maxToolCallsPerTurn}
                placeholder="4"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt(
                  "pi.maxToolCallsPerTurn",
                  current.pi.maxToolCallsPerTurn,
                  1,
                  32,
                  (maxToolCallsPerTurn) => ({
                    ...current,
                    pi: { ...current.pi, maxToolCallsPerTurn },
                  }),
                )}
              />
              <HarnessNumberSetting
                fieldKey="pi.timeoutMs"
                label="超时时间 (ms)"
                description="单次运行超时阈值（5000–3600000）。"
                value={current.pi.timeoutMs}
                placeholder="180000"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt("pi.timeoutMs", current.pi.timeoutMs, 5_000, 3_600_000, (timeoutMs) => ({
                  ...current,
                  pi: { ...current.pi, timeoutMs },
                }))}
              />
            </>
          ) : null}

          {activeKind === "acp" ? (
            <>
              <SettingRow
                label="默认 ACP Agent"
                description={`${acpAgents.filter((agent) => agent.enabled).length} 个已启用；对话直接由选定 Agent 处理`}
                control={
                  <Select
                    value={current.acp.defaultAgentId || ""}
                    onValueChange={(defaultAgentId) =>
                      commitHarness({ ...current, acp: { ...current.acp, defaultAgentId } })
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
              <HarnessNumberSetting
                fieldKey="acp.maxConcurrentSessions"
                label="最大并发进程数"
                description="同时保持活跃的 ACP 子进程会话上限（1–16）。"
                value={current.acp.maxConcurrentSessions}
                placeholder="4"
                pendingInputs={pendingInputs}
                onDraftChange={updateDraftField}
                onCommit={commitRequiredInt(
                  "acp.maxConcurrentSessions",
                  current.acp.maxConcurrentSessions,
                  1,
                  16,
                  (maxConcurrentSessions) => ({
                    ...current,
                    acp: { ...current.acp, maxConcurrentSessions },
                  }),
                )}
              />
              <SettingRow
                label="全局只读限制"
                description="开启后禁止任何 ACP Agent 授予 write / execute 权限。"
                control={
                  <Switch
                    aria-label="ACP 全局只读限制"
                    checked={current.acp.defaults.readonlyOnly}
                    onCheckedChange={(readonlyOnly) =>
                      commitHarness({
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
            </>
          ) : null}
        </Rows>
      </Panel>
    </Section>
  )
}
