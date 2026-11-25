import type { ApiContext } from "./context.js";
import { apiKeysApi } from "./api_keys.js";
import { capabilitiesApi } from "./capabilities.js";
import { documentsApi } from "./documents.js";
import { foldersApi } from "./folders.js";
import { graphApi, lintApi } from "./graph.js";
import { historyApi } from "./history.js";
import { ingestJobsApi } from "./ingest_jobs.js";
import { ingestReviewsApi } from "./ingest_reviews.js";
import { ingestSessionsApi } from "./ingest_sessions.js";
import { providersApi } from "./providers.js";
import { publicWikiApi } from "./public_wiki.js";
import { searchApi } from "./search.js";
import { settingsApi } from "./settings.js";
import { workspaceApi } from "./workspace.js";

export type Api = ReturnType<typeof createApi>;

export function createApi(ctx: ApiContext) {
  return {
    ...documentsApi(ctx),
    ...foldersApi(ctx),
    ...searchApi(ctx),
    ...graphApi(ctx),
    ...lintApi(ctx),
    ...workspaceApi(ctx),
    ...settingsApi(ctx),
    ...historyApi(ctx),
    ...providersApi(ctx),
    ...publicWikiApi(ctx),
    ...ingestJobsApi(ctx),
    ...ingestReviewsApi(ctx),
    ...ingestSessionsApi(ctx),
    ...capabilitiesApi(),
    ...apiKeysApi(ctx),
  };
}

export type { ApiContext } from "./context.js";
export { createApiContext } from "./context.js";
