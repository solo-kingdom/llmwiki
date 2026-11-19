import type { Store } from "../store/interfaces.js";
import { Client, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "./client.js";
import { loadConfig } from "./config.js";
import type { LLMConfig } from "./types.js";

export async function clientFromInstance(
  db: Store,
  instanceId: string,
  model: string,
): Promise<Client> {
  const instance = instanceId.trim();
  const modelId = model.trim();
  if (!instance || !modelId) {
    throw new Error(
      "provider instance and model are not configured; set them in Settings under Provider instances",
    );
  }

  const providerInstance = await db.getProviderInstance(instance);
  if (!providerInstance) {
    throw new Error(
      `provider instance "${instance}" not found; configure it in Settings under Provider instances`,
    );
  }
  if (!providerInstance.api_key.trim()) {
    const name = providerInstance.name || instance;
    throw new Error(
      `API key is not configured for provider instance "${name}"; set it in Settings under Provider instances`,
    );
  }

  let apiFormat = "openai";
  let baseUrl = providerInstance.base_url;
  const providerInfo = await db.getProviderInfo(providerInstance.catalog_id);
  if (providerInfo) {
    if (providerInfo.api_format) apiFormat = providerInfo.api_format;
    if (!baseUrl) baseUrl = providerInfo.api_base;
  }

  return newValidatedClient({
    provider: apiFormat,
    baseUrl,
    apiKey: providerInstance.api_key,
    model: modelId,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  });
}

export async function clientFromWorkspace(workspace: string): Promise<Client> {
  if (!workspace.trim()) {
    throw new Error(
      "provider instance and model are not configured; set them in Settings under Provider instances",
    );
  }
  const config = await loadConfig(workspace);
  const timeoutMs =
    config.request_timeout > 0 ? config.request_timeout * 1000 : DEFAULT_TIMEOUT_MS;
  const streamIdleTimeoutMs =
    config.stream_idle_timeout > 0
      ? config.stream_idle_timeout * 1000
      : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  return newValidatedClient({
    provider: config.provider,
    baseUrl: config.base_url,
    apiKey: config.api_key,
    model: config.model,
    timeoutMs,
    streamIdleTimeoutMs,
  });
}

function newValidatedClient(config: LLMConfig): Client {
  const client = new Client(config);
  client.validateRequest();
  return client;
}
