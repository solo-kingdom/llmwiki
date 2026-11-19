import { rebuildDerived } from "../ingest/rebuild.js";
import { openCliStore } from "./workspace.js";

export async function runReindex(databaseUrl?: string): Promise<void> {
  const store = await openCliStore(databaseUrl);
  try {
    const count = await rebuildDerived(store);
    console.log(`Rebuilt derived index for ${count} document(s)`);
  } finally {
    await store.close();
  }
}
