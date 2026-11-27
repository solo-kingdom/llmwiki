import type { Store } from "../store/interfaces.js";
import { Client, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "./client.js";
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
  const providerInfo = await db.getProviderInfo(providerInstance.catalog_id);
  const apiFormat =
    providerInstance.api_format.trim() || providerInfo?.api_format || "openai";
  const baseUrl =
    providerInstance.base_url.trim() || providerInfo?.api_base || "";

  if (apiFormat !== "ollama" && !providerInstance.api_key.trim()) {
    const name = providerInstance.name || instance;
    throw new Error(
      `API key is not configured for provider instance "${name}"; set it in Settings under Provider instances`,
    );
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

function newValidatedClient(config: LLMConfig): Client {
  const client = new Client(config);
  client.validateRequest();
  return client;
}
