import { writeFile } from "node:fs/promises";
import { buildDeterministicClusterPlan, detectOvercrowdedFolders } from "../engine/auto_cluster.js";
import { openCliStore } from "./workspace.js";

export async function runClusterPlan(
  options: { folder?: string; threshold?: number; minClusterSize?: number; out?: string },
  databaseUrl?: string,
): Promise<void> {
  const store = await openCliStore(databaseUrl);
  try {
    const threshold = options.threshold ?? 20;
    const targetFolders: string[] = [];
    if (options.folder && options.folder.trim()) {
      targetFolders.push(options.folder.trim());
    } else {
      const overcrowded = await detectOvercrowdedFolders(store, { wikiThreshold: threshold });
      for (const item of overcrowded) {
        if (item.kind === "wiki") targetFolders.push(item.path);
      }
    }

    const docs = await store.listDocumentsWithContent();
    const plans = targetFolders.map((folder) =>
      buildDeterministicClusterPlan(docs, folder, { minClusterSize: options.minClusterSize ?? 3 }),
    );
    const payload = {
      generated_at: new Date().toISOString(),
      threshold,
      plans,
      folders: plans.flatMap((p) => p.clusters),
      entries: plans.flatMap((p) => p.entries),
    };
    const json = JSON.stringify(payload, null, 2);
    if (options.out) {
      await writeFile(options.out, `${json}\n`, "utf8");
    } else {
      console.log(json);
    }
  } finally {
    await store.close();
  }
}
