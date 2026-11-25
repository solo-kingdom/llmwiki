import type { Pool } from "pg";
import type { Store } from "../interfaces.js";
import { activityRepo } from "./activity_logs.js";
import { apiKeysRepo } from "./api_keys.js";
import { archivesRepo } from "./archives.js";
import { chunksRepo } from "./chunks.js";
import { configRepo } from "./config.js";
import { documentsRepo } from "./documents.js";
import { foldersRepo } from "./folders.js";
import { graphRepo } from "./graph.js";
import { ingestJobsRepo } from "./ingest_jobs.js";
import { ingestReviewsRepo } from "./ingest_reviews.js";
import { ingestSessionsRepo } from "./ingest_sessions.js";
import { migrate } from "./migrations.js";
import { providersRepo } from "./providers.js";
import { referenceEntriesRepo } from "./reference_entries.js";
import { revisionsRepo } from "./revisions.js";
import { sourceBlobsRepo } from "./source_blobs.js";
import { workspaceRepo } from "./workspace.js";

export function createStore(pool: Pool): Store {
  const store = {
    ...documentsRepo(pool),
    ...foldersRepo(pool),
    ...archivesRepo(pool),
    ...chunksRepo(pool),
    ...graphRepo(pool),
    ...referenceEntriesRepo(pool),
    ...revisionsRepo(pool),
    ...sourceBlobsRepo(pool),
    ...workspaceRepo(pool),
    ...configRepo(pool),
    ...activityRepo(pool),
    ...ingestJobsRepo(pool),
    ...ingestSessionsRepo(pool),
    ...ingestReviewsRepo(pool),
    ...providersRepo(pool),
    ...apiKeysRepo(pool),
    close: async () => {
      await pool.end();
    },
  };
  return store as Store;
}

export async function openStore(pool: Pool): Promise<Store> {
  await migrate(pool);
  return createStore(pool);
}
