import { logger } from "../logger.js";
import type { Store } from "../store/interfaces.js";
import type { ModelInfo, ProviderInfo } from "../store/types.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
const SYNC_TIMEOUT_MS = 30_000;

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

export async function syncModelsDev(db: Store, signal?: AbortSignal): Promise<void> {
  logger.info(`syncing provider data from ${MODELS_DEV_URL}`);
  const timeout = AbortSignal.timeout(SYNC_TIMEOUT_MS);
  const response = await fetch(MODELS_DEV_URL, {
    headers: { "User-Agent": "llmwiki/1.0" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`models.dev returned HTTP ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, ModelsDevProvider>;
  const { providers, models } = convertModelsDev(raw);

  if (providers.length > 0) await db.upsertProviderInfo(providers);
  if (models.length > 0) await db.upsertModels(models);
  await db.setConfig("models_synced_at", new Date().toISOString());
  logger.info(`synced ${providers.length} providers and ${models.length} models from models.dev`);
}

export function convertModelsDev(raw: Record<string, ModelsDevProvider>): {
  providers: ProviderInfo[];
  models: ModelInfo[];
} {
  const providers: ProviderInfo[] = [];
  const models: ModelInfo[] = [];

  for (const provider of Object.values(raw)) {
    let apiFormat = "openai";
    if (provider.id === "anthropic") apiFormat = "anthropic";
    else if (provider.id === "ollama") apiFormat = "ollama";

    providers.push({
      id: provider.id,
      name: provider.name,
      api_base: provider.api ?? "",
      api_format: apiFormat,
      env_key: provider.env && provider.env.length > 0 ? (provider.env[0] ?? "") : "",
      doc_url: provider.doc ?? "",
    });

    for (const model of Object.values(provider.models ?? {})) {
      models.push({
        provider_id: provider.id,
        model_id: model.id,
        name: model.name,
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
