import { readFile } from "node:fs/promises";
import path from "node:path";
import { SEED_TOPIC_FOLDERS } from "../engine/scaffold.js";
import { engineStoreFromStore } from "../engine/adapter.js";
import { Reindexer } from "../engine/reindex.js";
import { CONFIG_WORKSPACE_PURPOSE, CONFIG_WORKSPACE_RULES } from "../ingest/prompts.js";
import { openCliStore, resolveWorkspaceDir as resolveCliWorkspace } from "./workspace.js";

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

    for (const folder of SEED_TOPIC_FOLDERS) {
      const existing = await store.getFolder(folder.path);
      if (!existing) await store.createFolder(folder);
      else if (!existing.display_name || !existing.description) {
        await store.updateFolder(folder.path, {
          display_name: existing.display_name || folder.display_name,
          description: existing.description || folder.description,
        });
      }
    }

    if (!dir) {
      console.log(`Initialized PostgreSQL workspace: ${wsName}`);
      return;
    }

    const workspace = resolveCliWorkspace(dir);
    for (const [filename, configKey] of [
      ["purpose.md", CONFIG_WORKSPACE_PURPOSE],
      ["rules.md", CONFIG_WORKSPACE_RULES],
    ] as const) {
      const existing = (await store.getConfig(configKey).catch(() => "")).trim();
      if (existing) continue;
      try {
        const raw = (await readFile(path.join(workspace, filename), "utf8")).trim();
        if (raw) await store.setConfig(configKey, raw);
      } catch {
        // ignore missing local rule files during one-way import
      }
    }

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
