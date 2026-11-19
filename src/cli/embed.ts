import { embeddingClient } from "../llm/embeddings.js";
import type { ChunkEmbedding } from "../store/types.js";
import { openCliStore } from "./workspace.js";

export async function runEmbed(batchSize: number, databaseUrl?: string): Promise<void> {
  const batch = batchSize > 0 ? batchSize : 32;
  const store = await openCliStore(databaseUrl);
  try {
    const { client, settings } = await embeddingClient(store);
    let total = 0;
    for (;;) {
      const chunks = await store.chunksMissingEmbedding(settings.model, batch);
      if (chunks.length === 0) break;
      const inputs = chunks.map((chunk) => chunk.content);
      const vectors = await client.embeddings(settings.model, inputs);
      const embeddings: ChunkEmbedding[] = chunks.map((chunk, index) => {
        const vector = vectors[index] ?? [];
        if (settings.dim > 0 && vector.length !== settings.dim) {
          throw new Error(
            `embedding dimension mismatch: got ${vector.length}, configured ${settings.dim}`,
          );
        }
        return {
          chunk_id: chunk.id,
          model: settings.model,
          dim: vector.length,
          embedding: vector,
        };
      });
      await store.storeChunkEmbeddings(embeddings);
      total += embeddings.length;
      console.error(`embedded ${total} chunk(s)`);
    }
    console.log(`Embedded ${total} chunk(s) with ${settings.model}`);
  } finally {
    await store.close();
  }
}
