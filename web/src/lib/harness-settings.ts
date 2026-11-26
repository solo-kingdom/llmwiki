import type { AgentKind, HarnixSettings, ProviderInstance, Settings } from "@/types"

export const DEFAULT_HARNIX_SETTINGS: HarnixSettings = {
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

export interface ResolvedHarnessModelBinding {
  instanceId: string
  model: string
  instance: ProviderInstance | undefined
  availableModels: string[]
  missingInstance: boolean
  inheritedFromFallback: boolean
}

export function resolveHarnessModelBinding(
  kind: AgentKind,
  harnixSettings: HarnixSettings,
  fallbackInstanceId: string,
  fallbackModel: string,
  instances: readonly ProviderInstance[],
): ResolvedHarnessModelBinding {
  if (kind === "acp") {
    return {
      instanceId: "",
      model: "",
      instance: undefined,
      availableModels: [],
      missingInstance: false,
      inheritedFromFallback: false,
    }
  }

  const bound = kind === "pi" ? harnixSettings.pi : harnixSettings.native
  const explicitInstanceId = bound.providerInstanceId?.trim() ?? ""
  const explicitModel = bound.model?.trim() ?? ""
  const inheritedFromFallback = explicitInstanceId === ""
  const rawInstanceId = explicitInstanceId || fallbackInstanceId.trim()
  const rawModel = explicitInstanceId !== "" ? explicitModel : (explicitModel || fallbackModel.trim())
  const instance = instances.find((item) => item.id === rawInstanceId)
  const availableModels = instance?.models ?? []
  const missingInstance = rawInstanceId !== "" && instance === undefined
  const model =
    instance !== undefined && availableModels.includes(rawModel)
      ? rawModel
      : (instance === undefined ? rawModel : "")

  return {
    instanceId: instance ? instance.id : "",
    model,
    instance,
    availableModels,
    missingInstance,
    inheritedFromFallback,
  }
}

export function applyHarnessModelBinding(
  harnixSettings: HarnixSettings,
  kind: "native" | "pi",
  instanceId: string,
  model: string,
): Partial<Settings> {
  const cleanInstanceId = instanceId.trim()
  const cleanModel = model.trim()
  if (kind === "native") {
    const nextNative = { ...harnixSettings.native }
    if (cleanInstanceId !== "") nextNative.providerInstanceId = cleanInstanceId
    else delete nextNative.providerInstanceId
    if (cleanModel !== "") nextNative.model = cleanModel
    else delete nextNative.model
    return {
      harnix_settings: { ...harnixSettings, native: nextNative },
      ...(cleanInstanceId !== "" ? { last_instance_id: cleanInstanceId } : {}),
      ...(cleanModel !== "" ? { last_model: cleanModel } : {}),
    }
  }

  const nextPi = { ...harnixSettings.pi }
  if (cleanInstanceId !== "") nextPi.providerInstanceId = cleanInstanceId
  else delete nextPi.providerInstanceId
  if (cleanModel !== "") nextPi.model = cleanModel
  else delete nextPi.model
  return {
    harnix_settings: { ...harnixSettings, pi: nextPi },
    ...(cleanInstanceId !== "" ? { last_instance_id: cleanInstanceId } : {}),
    ...(cleanModel !== "" ? { last_model: cleanModel } : {}),
  }
}

function parseIntInRange(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

function parseFloatInRange(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

export function flushHarnessNumericInputs(
  harnixSettings: HarnixSettings,
  kind: AgentKind,
  pendingInputs: Readonly<Record<string, string>>,
): HarnixSettings {
  if (kind === "native") {
    const nextNative = { ...harnixSettings.native }
    const maxTurns = parseIntInRange(pendingInputs["native.maxTurns"], 1, 64)
    if (maxTurns !== undefined) nextNative.maxTurns = maxTurns
    const maxToolCalls = parseIntInRange(pendingInputs["native.maxToolCalls"], 1, 256)
    if (maxToolCalls !== undefined) nextNative.maxToolCalls = maxToolCalls
    const maxToolCallsPerTurn = parseIntInRange(pendingInputs["native.maxToolCallsPerTurn"], 1, 32)
    if (maxToolCallsPerTurn !== undefined) nextNative.maxToolCallsPerTurn = maxToolCallsPerTurn
    const timeoutMs = parseIntInRange(pendingInputs["native.timeoutMs"], 5_000, 3_600_000)
    if (timeoutMs !== undefined) nextNative.timeoutMs = timeoutMs

    if ("native.temperature" in pendingInputs) {
      const rawTemp = pendingInputs["native.temperature"]?.trim() ?? ""
      if (rawTemp === "") {
        delete nextNative.temperature
      } else {
        const temp = parseFloatInRange(rawTemp, 0, 2)
        if (temp !== undefined) nextNative.temperature = temp
      }
    }

    if ("native.maxTokens" in pendingInputs) {
      const rawMaxTokens = pendingInputs["native.maxTokens"]?.trim() ?? ""
      if (rawMaxTokens === "") {
        delete nextNative.maxTokens
      } else {
        const maxTokens = parseIntInRange(rawMaxTokens, 1, 200_000)
        if (maxTokens !== undefined) nextNative.maxTokens = maxTokens
      }
    }

    return { ...harnixSettings, native: nextNative }
  }

  if (kind === "pi") {
    const nextPi = { ...harnixSettings.pi }
    const contextWindow = parseIntInRange(pendingInputs["pi.contextWindow"], 1_024, 2_000_000)
    if (contextWindow !== undefined) nextPi.contextWindow = contextWindow
    const maxTokens = parseIntInRange(pendingInputs["pi.maxTokens"], 1, 200_000)
    if (maxTokens !== undefined) nextPi.maxTokens = maxTokens
    const maxTurns = parseIntInRange(pendingInputs["pi.maxTurns"], 1, 64)
    if (maxTurns !== undefined) nextPi.maxTurns = maxTurns
    const maxToolCalls = parseIntInRange(pendingInputs["pi.maxToolCalls"], 1, 256)
    if (maxToolCalls !== undefined) nextPi.maxToolCalls = maxToolCalls
    const maxToolCallsPerTurn = parseIntInRange(pendingInputs["pi.maxToolCallsPerTurn"], 1, 32)
    if (maxToolCallsPerTurn !== undefined) nextPi.maxToolCallsPerTurn = maxToolCallsPerTurn
    const timeoutMs = parseIntInRange(pendingInputs["pi.timeoutMs"], 5_000, 3_600_000)
    if (timeoutMs !== undefined) nextPi.timeoutMs = timeoutMs
    return { ...harnixSettings, pi: nextPi }
  }

  const nextAcp = { ...harnixSettings.acp }
  const maxConcurrent = parseIntInRange(pendingInputs["acp.maxConcurrentSessions"], 1, 16)
  if (maxConcurrent !== undefined) nextAcp.maxConcurrentSessions = maxConcurrent
  return { ...harnixSettings, acp: nextAcp }
}

export function buildSwitchHarnessPatch(
  harnixSettings: HarnixSettings,
  nextKind: AgentKind,
  pendingInputs: Readonly<Record<string, string>>,
  instances: readonly ProviderInstance[],
): Partial<Settings> {
  const flushed = flushHarnessNumericInputs(harnixSettings, harnixSettings.defaultKind, pendingInputs)
  const nextSettings: HarnixSettings = {
    ...flushed,
    defaultKind: nextKind,
  }

  if (nextKind === "acp") {
    return { harnix_settings: nextSettings }
  }

  const bound = nextKind === "pi" ? nextSettings.pi : nextSettings.native
  const instanceId = bound.providerInstanceId?.trim() ?? ""
  const model = bound.model?.trim() ?? ""
  const instance = instances.find((item) => item.id === instanceId)
  const validModel =
    instance !== undefined && model !== "" && (instance.models ?? []).includes(model)
      ? model
      : ""

  return {
    harnix_settings: nextSettings,
    ...(instance !== undefined ? { last_instance_id: instance.id } : {}),
    ...(instance !== undefined && validModel !== "" ? { last_model: validModel } : {}),
  }
}

export function resolveHarnessAdapterHint(
  kind: AgentKind,
  instance: ProviderInstance | undefined,
  missingInstance: boolean,
): string {
  if (kind === "acp") {
    return "通过 stdio JSON-RPC 2.0 驱动外部 ACP Agent，对话不使用上方 Provider 实例；后台摄入任务仍沿用下方模型配置。"
  }
  if (missingInstance) {
    return "当前绑定的 Provider 实例已不存在，请重新选择或前往上方添加实例。"
  }
  if (!instance) {
    return "未绑定 Provider 实例；请先在上方「Provider 实例」中创建并选择模型。"
  }
  const format = instance.api_format === "anthropic" ? "anthropic" : "openai-compatible"
  if (kind === "pi") {
    return `Pi 路由将按 ${format} 协议连接「${instance.name}」。`
  }
  return `Native 将直接以 ${format} 协议连接「${instance.name}」。`
}
