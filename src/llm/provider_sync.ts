import { logger } from "../logger.js";
import type { Store } from "../store/interfaces.js";
import type { ModelInfo, ProviderInfo } from "../store/types.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const CATALOG_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MODELS_DEV_MAX_BYTES = 16 * 1024 * 1024;
const SYNC_TIMEOUT_MS = 30_000;

export interface CatalogSyncResult {
  provider_count: number;
  model_count: number;
  synced_at: string;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  api?: string;
  doc?: string;
  npm?: string;
  models?: Record<string, ModelsDevModel>;
}

export interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  release_date?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } | null;
}

export function isCatalogStale(
  syncedAt: string,
  now: Date = new Date(),
  maxAgeMs: number = CATALOG_SYNC_INTERVAL_MS,
): boolean {
  const trimmed = syncedAt.trim();
  if (!trimmed) return true;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed >= maxAgeMs;
}

export async function syncModelsDev(db: Store, signal?: AbortSignal): Promise<CatalogSyncResult> {
  logger.info(`syncing provider data from ${MODELS_DEV_URL}`);
  const timeout = AbortSignal.timeout(SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_DEV_URL, {
      headers: { "User-Agent": "llmwiki/1.0", Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`models.dev returned HTTP ${response.status}`);
    }
    const bytes = await readBoundedBytes(response, MODELS_DEV_MAX_BYTES);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("models.dev payload must be a JSON object");
    }
    const { providers, models } = convertModelsDev(parsed as Record<string, ModelsDevProvider>);
    if (providers.length === 0 || models.length === 0) {
      throw new Error("models.dev payload produced no providers or models");
    }

    await db.upsertProviderInfo(providers);
    await db.upsertModels(models);
    const syncedAt = new Date().toISOString();
    await db.setConfig("models_synced_at", syncedAt);
    await db.setConfig("models_sync_error", "");
    logger.info(`synced ${providers.length} providers and ${models.length} models from models.dev`);
    return { provider_count: providers.length, model_count: models.length, synced_at: syncedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.setConfig("models_sync_error", message).catch(() => {});
    throw error;
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error("models.dev response body is empty");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload exceeds size limit").catch(() => {});
        throw new Error(`models.dev payload exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("models.dev response body is empty");
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function convertModelsDev(raw: Record<string, ModelsDevProvider>): {
  providers: ProviderInfo[];
  models: ModelInfo[];
} {
  const providers: ProviderInfo[] = [];
  const models: ModelInfo[] = [];

  for (const provider of Object.values(raw)) {
    if (!provider || typeof provider !== "object") continue;
    const providerId = typeof provider.id === "string" ? provider.id.trim() : "";
    const providerName = typeof provider.name === "string" ? provider.name.trim() : "";
    if (!providerId || !providerName) continue;

    const npm = typeof provider.npm === "string" ? provider.npm.trim() : "";
    let apiFormat = "openai";
    if (providerId === "anthropic" || npm === "@ai-sdk/anthropic") apiFormat = "anthropic";
    else if (providerId === "ollama") apiFormat = "ollama";

    providers.push({
      id: providerId,
      name: providerName,
      api_base: typeof provider.api === "string" ? provider.api : "",
      api_format: apiFormat,
      env_key: Array.isArray(provider.env) && provider.env.length > 0 ? (provider.env[0] ?? "") : "",
      doc_url: typeof provider.doc === "string" ? provider.doc : "",
      npm,
    });

    for (const model of Object.values(provider.models ?? {})) {
      if (!model || typeof model !== "object") continue;
      const modelId = typeof model.id === "string" ? model.id.trim() : "";
      if (!modelId) continue;
      models.push({
        provider_id: providerId,
        model_id: modelId,
        name: (typeof model.name === "string" ? model.name.trim() : "") || modelId,
        family: model.family ?? "",
        context_limit: model.limit?.context ?? 0,
        output_limit: model.limit?.output ?? 0,
        cost_input: model.cost?.input ?? 0,
        cost_output: model.cost?.output ?? 0,
        reasoning: model.reasoning ?? false,
        tool_call: model.tool_call ?? false,
        attachment: model.attachment ?? false,
        modalities: JSON.stringify(model.modalities ?? {}),
      });
    }
  }
  return { providers, models };
}
