import type { Store } from "../store/interfaces.js";
import type { Client } from "./client.js";
import { clientFromInstance } from "./instance_client.js";
import type { EmbeddingSettings } from "./types.js";

export const CONFIG_EMBEDDING_INSTANCE_ID = "embedding_instance_id";
export const CONFIG_EMBEDDING_MODEL = "embedding_model";
export const CONFIG_EMBEDDING_DIM = "embedding_dim";

export async function loadEmbeddingSettings(db: Store | null): Promise<EmbeddingSettings> {
  if (!db) throw new Error("no database");
  const instanceId = (await db.getConfig(CONFIG_EMBEDDING_INSTANCE_ID)).trim();
  const model = (await db.getConfig(CONFIG_EMBEDDING_MODEL)).trim();
  const dimRaw = await db.getConfig(CONFIG_EMBEDDING_DIM);
  const settings: EmbeddingSettings = { instanceId, model, dim: 0 };
  if (!settings.instanceId || !settings.model) {
    throw new Error(
      `embedding is not configured: set ${CONFIG_EMBEDDING_INSTANCE_ID} and ${CONFIG_EMBEDDING_MODEL} in Settings`,
    );
  }
  if (dimRaw) {
    const dim = Number.parseInt(dimRaw, 10);
    if (Number.isFinite(dim) && dim > 0) settings.dim = dim;
  }
  return settings;
}

export async function embeddingClient(
  db: Store,
): Promise<{ client: Client; settings: EmbeddingSettings }> {
  const settings = await loadEmbeddingSettings(db);
  const client = await clientFromInstance(db, settings.instanceId, settings.model);
  if (client.provider !== "openai") {
    throw new Error(`embeddings require an OpenAI-compatible provider, got "${client.provider}"`);
  }
  return { client, settings };
}
