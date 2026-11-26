import { describe, expect, it } from "vitest"
import {
  adapterBaseUrl,
  adapterFromProvider,
  baseUrlForAdapter,
  catalogBaseUrl,
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
})
