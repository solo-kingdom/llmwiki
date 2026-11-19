import path from "node:path";
import { ensureWorkspaceStructure, writeWorkspaceScaffoldsIfMissing } from "../engine/scaffold.js";
import { engineStoreFromStore } from "../engine/adapter.js";
import { Reindexer } from "../engine/reindex.js";
import { writeWorkspaceScaffoldsIfMissing as writeIngestScaffolds } from "../ingest/prompts.js";
import { importSettings } from "../workspace/settings.js";
import { resolveWorkspaceDir as resolveCliWorkspace } from "./workspace.js";
import { openCliStore } from "./workspace.js";

export async function runInit(dir: string | undefined, name: string | undefined, databaseUrl?: string): Promise<void> {
  const store = await openCliStore(databaseUrl);
  try {
    const wsName = name || (dir ? path.basename(path.resolve(dir)) : "") || "default";
    await store.upsertWorkspace({
      id: "default",
      name: wsName,
      description: "",
      user_id: "default",
      created_at: "",
    });

    if (!dir) {
      console.log(`Initialized PostgreSQL workspace: ${wsName}`);
      return;
    }

    const workspace = resolveCliWorkspace(dir);
    await ensureWorkspaceStructure(workspace);
    const initDate = new Date().toISOString().slice(0, 10);
    await writeWorkspaceScaffoldsIfMissing(workspace, initDate);
    await writeIngestScaffolds(workspace);
    await importSettings(store, workspace);

    const reindexer = new Reindexer(engineStoreFromStore(store), workspace);
    const count = await reindexer.rebuild("default");
    const seeded = await store.seedInitialRevisions("migration");
    console.log(`Initialized PostgreSQL workspace: ${wsName}`);
    if (count > 0) console.log(`Imported ${count} files from ${workspace}`);
    if (seeded > 0) console.log(`Seeded ${seeded} initial revisions`);
  } finally {
    await store.close();
  }
}
