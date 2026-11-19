import path from "node:path";
import { Client } from "../llm/client.js";
import { loadConfig, toClientConfig } from "../llm/config.js";
import { Pipeline } from "../ingest/pipeline.js";
import { openCliStore, resolveWorkspaceDir } from "./workspace.js";

export async function runIngest(
  sourceFile: string,
  forceOverwrite: boolean,
  databaseUrl?: string,
): Promise<void> {
  const workspace = resolveWorkspaceDir(undefined);
  const absoluteSource = path.resolve(sourceFile);
  const store = await openCliStore(databaseUrl);
  try {
    const config = await loadConfig(workspace);
    const client = new Client(toClientConfig(config));
    const pipeline = new Pipeline(workspace, store, client);
    pipeline.setForceOverwrite(forceOverwrite);
    pipeline.setChangeSetMeta("ingest", "", "", path.basename(absoluteSource), "");

    const files = await pipeline.ingest(absoluteSource);
    console.log(`Ingest complete: ${files.length} wiki file(s) written`);
    for (const file of files) console.log(`  - ${file}`);
  } finally {
    await store.close();
  }
}
