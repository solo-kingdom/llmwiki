import path from "node:path";
import { clientFromInstance } from "../llm/instance_client.js";
import { loadWorkspaceRules } from "../ingest/prompts.js";
import { Pipeline } from "../ingest/pipeline.js";
import { toolLoopConfigForModeFromStore } from "../mcp/tool_loop_settings.js";
import { openCliStore } from "./workspace.js";

export async function runIngest(
  sourceFile: string,
  forceOverwrite: boolean,
  databaseUrl?: string,
): Promise<void> {
  const absoluteSource = path.resolve(sourceFile);
  const store = await openCliStore(databaseUrl);
  try {
    const instanceId =
      (await store.getConfig("job_instance_id")).trim() ||
      (await store.getConfig("last_instance_id")).trim();
    let model =
      (await store.getConfig("job_model")).trim() ||
      (await store.getConfig("last_model")).trim();
    if (instanceId && !model) {
      const inst = await store.getProviderInstance(instanceId);
      model = inst?.models[0] ?? "";
    }
    const client = await clientFromInstance(store, instanceId, model);
    const pipeline = new Pipeline("", store, client);
    pipeline.setToolLoopConfig(await toolLoopConfigForModeFromStore("", store));
    pipeline.setWorkspaceRules(await loadWorkspaceRules(store));
    pipeline.setForceOverwrite(forceOverwrite);
    pipeline.setChangeSetMeta("ingest", "", "", path.basename(absoluteSource), "");

    const files = await pipeline.ingest(absoluteSource);
    console.log(`Ingest complete: ${files.length} wiki file(s) written`);
    for (const file of files) console.log(`  - ${file}`);
  } finally {
    await store.close();
  }
}
