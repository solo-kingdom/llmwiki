import { describe, expect, it } from "vitest"
import {
  adapterBaseUrl,
  adapterFromProvider,
  baseUrlForAdapter,
  catalogBaseUrl,
  endpointForFormat,
  inferProtocolFromBaseUrl,
  isUsableBaseUrl,
} from "./provider-autofill"

describe("provider-autofill", () => {
  it("infers api_format from provider id and npm", () => {
    expect(adapterFromProvider({ id: "anthropic", npm: "@ai-sdk/anthropic", api_format: "anthropic" })).toBe("anthropic")
    expect(adapterFromProvider({ id: "minimax", npm: "@ai-sdk/anthropic", api_format: "openai" })).toBe("anthropic")
    expect(adapterFromProvider({ id: "ollama", npm: "", api_format: "ollama" })).toBe("ollama")
    expect(adapterFromProvider({ id: "deepseek", npm: "@ai-sdk/openai-compatible", api_format: "openai" })).toBe("openai")
  })

  it("validates http and https URLs while rejecting template placeholders", () => {
    expect(isUsableBaseUrl("https://api.openai.com/v1")).toBe(true)
    expect(isUsableBaseUrl("http://localhost:11434")).toBe(true)
    expect(isUsableBaseUrl("https://${AZURE_RESOURCE}.openai.azure.com")).toBe(false)
    expect(isUsableBaseUrl("not-a-url")).toBe(false)
  })

  it("projects dual-protocol URLs and known endpoints across formats", () => {
    expect(baseUrlForAdapter("https://api.example.com/anthropic/v1", "openai")).toBe("https://api.example.com/v1")
    expect(adapterBaseUrl("anthropic", "deepseek", "https://api.deepseek.com")).toBe("https://api.deepseek.com/anthropic")
    expect(adapterBaseUrl("openai", "deepseek", "https://api.deepseek.com/anthropic")).toBe("https://api.deepseek.com")
    expect(catalogBaseUrl({ id: "openai", api_base: "" }, "openai")).toEqual({
      url: "https://api.openai.com/v1",
      source: "known",
    })
    expect(catalogBaseUrl({ id: "custom-x", api_base: "https://api.custom-x.dev/v1" }, "openai")).toEqual({
      url: "https://api.custom-x.dev/v1",
      source: "provider",
    })
  })

  it("detects and rewrites protocol mismatches on dual-protocol hosts", () => {
    expect(inferProtocolFromBaseUrl("https://api.minimaxi.com/v1")).toBe("openai")
    expect(inferProtocolFromBaseUrl("https://api.minimaxi.com/anthropic/v1")).toBe("anthropic")
    expect(inferProtocolFromBaseUrl("https://api.deepseek.com")).toBe("openai")
    expect(inferProtocolFromBaseUrl("https://api.deepseek.com/anthropic")).toBe("anthropic")
    expect(inferProtocolFromBaseUrl("https://api.openai.com/v1")).toBeUndefined()

    expect(endpointForFormat("https://api.minimaxi.com/v1", "anthropic")).toBe(
      "https://api.minimaxi.com/anthropic/v1",
    )
    expect(endpointForFormat("https://api.minimax.io/anthropic/v1", "openai")).toBe(
      "https://api.minimax.io/v1",
    )
    expect(endpointForFormat("https://api.openai.com/v1", "anthropic")).toBeUndefined()
  })

  it("maps the minimax catalog to its current regional domains", () => {
    expect(catalogBaseUrl({ id: "minimax", api_base: "" }, "openai")).toEqual({
      url: "https://api.minimax.io/v1",
      source: "known",
    })
    expect(catalogBaseUrl({ id: "minimax", api_base: "" }, "anthropic")).toEqual({
      url: "https://api.minimax.io/anthropic/v1",
      source: "known",
    })
    expect(catalogBaseUrl({ id: "openai", api_base: "https://api.openai.com/v1" }, "ollama")).toBeUndefined()
  })

  it("prefers the models.dev endpoint when it fits the requested protocol", () => {
    expect(
      catalogBaseUrl({ id: "minimax-cn", api_base: "https://api.minimax.cn/anthropic/v1" }, "openai"),
    ).toEqual({ url: "https://api.minimax.cn/v1", source: "provider" })
    expect(
      catalogBaseUrl({ id: "minimax-cn", api_base: "https://api.minimax.cn/anthropic/v1" }, "anthropic"),
    ).toEqual({ url: "https://api.minimax.cn/anthropic/v1", source: "provider" })
    // OpenAI-only catalog entry behind the Anthropic adapter: use the curated endpoint.
    expect(catalogBaseUrl({ id: "deepseek", api_base: "https://api.deepseek.com" }, "anthropic")).toEqual({
      url: "https://api.deepseek.com/anthropic",
      source: "known",
    })
  })
})
