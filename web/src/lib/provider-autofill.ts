import type { Provider, ProviderApiFormat } from "@/types"

export function adapterFromProvider(
  provider: Pick<Provider, "id" | "npm" | "api_format"> | undefined,
): ProviderApiFormat {
  if (!provider) return "openai"
  if (provider.id === "anthropic" || provider.npm === "@ai-sdk/anthropic") return "anthropic"
  if (provider.id === "ollama") return "ollama"
  if (provider.api_format === "anthropic" || provider.api_format === "ollama") {
    return provider.api_format
  }
  return "openai"
}

export const KNOWN_BASE_URLS: Readonly<Record<string, string>> = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  togetherai: "https://api.together.xyz/v1",
  cerebras: "https://api.cerebras.ai/v1",
  cohere: "https://api.cohere.ai/compatibility/v1",
})

export const PROVIDER_ENDPOINTS: Readonly<
  Record<string, { readonly openai?: string; readonly anthropic?: string; readonly ollama?: string }>
> = Object.freeze({
  anthropic: { anthropic: "https://api.anthropic.com/v1" },
  ollama: { ollama: "http://localhost:11434" },
  deepseek: {
    openai: "https://api.deepseek.com",
    anthropic: "https://api.deepseek.com/anthropic",
  },
  zhipuai: {
    openai: "https://open.bigmodel.cn/api/paas/v4",
    anthropic: "https://open.bigmodel.cn/api/anthropic",
  },
  "minimax-cn": {
    openai: "https://api.minimax.cn/v1",
    anthropic: "https://api.minimax.cn/anthropic/v1",
  },
  minimax: {
    openai: "https://api.minimaxi.com/v1",
    anthropic: "https://api.minimaxi.com/anthropic",
  },
})

const hostOf = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    return new URL(value).host
  } catch {
    return undefined
  }
}

const trimUrl = (url: URL): string => {
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/u, "")
}

/** 允许 http:// 与 https://（支持本地 Ollama / 局域网代理），拒绝含 ${ENV} 模板段。 */
export function isUsableBaseUrl(value: string | undefined): value is string {
  if (!value || !value.trim() || value.includes("${")) return false
  try {
    const parsed = new URL(value.trim())
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== ""
  } catch {
    return false
  }
}

export function baseUrlForAdapter(catalogUrl: string, format: ProviderApiFormat): string {
  if (!isUsableBaseUrl(catalogUrl) || format === "ollama") return catalogUrl
  let parsed: URL
  try {
    parsed = new URL(catalogUrl)
  } catch {
    return catalogUrl
  }
  const path = parsed.pathname.replace(/\/+$/u, "")
  if (!/\/anthropic(?:\/v1)?$/u.test(path)) return catalogUrl
  if (format === "anthropic") {
    parsed.pathname = path
    return trimUrl(parsed)
  }
  parsed.pathname = path.endsWith("/anthropic/v1")
    ? `${path.slice(0, -"/anthropic/v1".length)}/v1`
    : `${path.slice(0, -"/anthropic".length)}/v1`
  return trimUrl(parsed)
}

export function adapterBaseUrl(
  format: ProviderApiFormat,
  catalogId: string | undefined,
  baseUrl: string | undefined,
): string | undefined {
  const direct = catalogId ? PROVIDER_ENDPOINTS[catalogId]?.[format] : undefined
  if (direct) return direct
  const host = hostOf(baseUrl)
  if (host) {
    const match = Object.values(PROVIDER_ENDPOINTS).find((entry) =>
      Object.values(entry).some((url) => hostOf(url) === host),
    )
    const fromHost = match?.[format]
    if (fromHost) return fromHost
  }
  if (!baseUrl || !isUsableBaseUrl(baseUrl)) return undefined
  return baseUrlForAdapter(baseUrl, format)
}

export type CatalogBaseUrlSource = "provider" | "known"
export interface CatalogBaseUrl {
  readonly url: string
  readonly source: CatalogBaseUrlSource
}

export function catalogBaseUrl(
  provider: Pick<Provider, "id" | "api_base"> | undefined,
  format: ProviderApiFormat,
): CatalogBaseUrl | undefined {
  if (!provider) return undefined
  const endpointByFormat = PROVIDER_ENDPOINTS[provider.id]?.[format]
  if (isUsableBaseUrl(endpointByFormat)) {
    return { url: endpointByFormat, source: "known" }
  }
  if (isUsableBaseUrl(provider.api_base)) {
    return { url: baseUrlForAdapter(provider.api_base, format), source: "provider" }
  }
  const known = KNOWN_BASE_URLS[provider.id]
  return isUsableBaseUrl(known) ? { url: known, source: "known" } : undefined
}
