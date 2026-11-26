import { describe, expect, it } from "vitest"
import type { ProviderInstance } from "@/types"
import {
  applyHarnessModelBinding,
  buildSwitchHarnessPatch,
  DEFAULT_HARNIX_SETTINGS,
  flushHarnessNumericInputs,
  resolveHarnessAdapterHint,
  resolveHarnessModelBinding,
} from "./harness-settings"

const INSTANCES: ProviderInstance[] = [
  {
    id: "inst_openai",
    name: "OpenAI",
    catalog_id: "openai",
    api_format: "openai",
    api_key_masked: "sk-***",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini"],
    created_at: "",
    updated_at: "",
  },
  {
    id: "inst_claude",
    name: "Anthropic",
    catalog_id: "anthropic",
    api_format: "anthropic",
    api_key_masked: "sk-ant-***",
    base_url: "https://api.anthropic.com",
    models: ["claude-sonnet-4"],
    created_at: "",
    updated_at: "",
  },
]

describe("harness-settings helpers", () => {
  it("preserves per-implementation settings and bound models across round-trip switches", () => {
    const withNativeModel = applyHarnessModelBinding(
      { ...DEFAULT_HARNIX_SETTINGS, native: { ...DEFAULT_HARNIX_SETTINGS.native, maxTurns: 12 } },
      "native",
      "inst_openai",
      "gpt-5",
    ).harnix_settings!

    // Switch native -> pi while flushing an unblurred input in native
    const toPiPatch = buildSwitchHarnessPatch(
      withNativeModel,
      "pi",
      { "native.maxToolCalls": "48", "native.temperature": "0.3" },
      INSTANCES,
    )
    expect(toPiPatch.harnix_settings?.defaultKind).toBe("pi")
    expect(toPiPatch.harnix_settings?.native.maxToolCalls).toBe(48)
    expect(toPiPatch.harnix_settings?.native.temperature).toBe(0.3)
    expect(toPiPatch.harnix_settings?.native.providerInstanceId).toBe("inst_openai")
    expect(toPiPatch.harnix_settings?.native.model).toBe("gpt-5")

    // Configure pi's own model and reasoning
    const withPiModel = applyHarnessModelBinding(
      {
        ...toPiPatch.harnix_settings!,
        pi: { ...toPiPatch.harnix_settings!.pi, reasoning: true },
      },
      "pi",
      "inst_claude",
      "claude-sonnet-4",
    ).harnix_settings!

    // Switch pi -> acp (does not set last_instance_id / last_model)
    const toAcpPatch = buildSwitchHarnessPatch(withPiModel, "acp", {}, INSTANCES)
    expect(toAcpPatch.harnix_settings?.defaultKind).toBe("acp")
    expect("last_instance_id" in toAcpPatch).toBe(false)
    expect(toAcpPatch.harnix_settings?.pi.providerInstanceId).toBe("inst_claude")
    expect(toAcpPatch.harnix_settings?.pi.reasoning).toBe(true)

    // Switch acp -> native (restores native's model and parameters intact)
    const backToNativePatch = buildSwitchHarnessPatch(
      toAcpPatch.harnix_settings!,
      "native",
      { "acp.maxConcurrentSessions": "6" },
      INSTANCES,
    )
    expect(backToNativePatch.harnix_settings?.defaultKind).toBe("native")
    expect(backToNativePatch.harnix_settings?.acp.maxConcurrentSessions).toBe(6)
    expect(backToNativePatch.harnix_settings?.native.maxTurns).toBe(12)
    expect(backToNativePatch.harnix_settings?.native.maxToolCalls).toBe(48)
    expect(backToNativePatch.harnix_settings?.native.providerInstanceId).toBe("inst_openai")
    expect(backToNativePatch.last_instance_id).toBe("inst_openai")
    expect(backToNativePatch.last_model).toBe("gpt-5")
  })

  it("clears optional temperature/maxTokens when flushed empty and handles missing instances", () => {
    const flushed = flushHarnessNumericInputs(
      {
        ...DEFAULT_HARNIX_SETTINGS,
        native: { ...DEFAULT_HARNIX_SETTINGS.native, temperature: 0.7, maxTokens: 2048 },
      },
      "native",
      { "native.temperature": "", "native.maxTokens": "  " },
    )
    expect(flushed.native.temperature).toBeUndefined()
    expect(flushed.native.maxTokens).toBeUndefined()

    const binding = resolveHarnessModelBinding(
      "native",
      {
        ...DEFAULT_HARNIX_SETTINGS,
        native: { ...DEFAULT_HARNIX_SETTINGS.native, providerInstanceId: "deleted_inst", model: "x" },
      },
      "inst_openai",
      "gpt-5",
      INSTANCES,
    )
    expect(binding.missingInstance).toBe(true)
    expect(binding.instanceId).toBe("")
    expect(resolveHarnessAdapterHint("native", undefined, true)).toContain("不存在")
  })
})
