import type { Context } from "hono";
import { recordSync } from "../activity/index.js";
import { isApiKeyRequest } from "../server/auth.js";
import * as acpConfig from "../acp/config.js";
import { validateRulesSupplement } from "../ingest/prompts.js";
import * as mcpConfig from "../mcp/config.js";
import {
  CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA,
  parseToolLoopMaxCallsPerRound,
  parseToolLoopMaxRounds,
  sessionToolLoopMaxCallsForResponse,
  sessionToolLoopMaxRoundsForResponse,
} from "../mcp/tool_loop_settings.js";
import {
  CONFIG_EMBEDDING_DIM,
  CONFIG_EMBEDDING_INSTANCE_ID,
  CONFIG_EMBEDDING_MODEL,
} from "../llm/embeddings.js";
import {
  ArchiveStorageService,
  defaultArchiveLocalDir,
  parseArchiveInlineMaxBytes,
} from "../archive/storage.js";
import {
  CONFIG_API_TOKEN,
  CONFIG_ARCHIVE_INLINE_MAX_BYTES,
  CONFIG_ARCHIVE_LOCAL_DIR,
  CONFIG_ARCHIVE_S3_ACCESS_KEY_ID,
  CONFIG_ARCHIVE_S3_BUCKET,
  CONFIG_ARCHIVE_S3_ENDPOINT,
  CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE,
  CONFIG_ARCHIVE_S3_PREFIX,
  CONFIG_ARCHIVE_S3_REGION,
  CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY,
  CONFIG_ARCHIVE_STORAGE_BACKEND,
  DEFAULT_ARCHIVE_INLINE_MAX_BYTES,
  DEFAULT_JOB_EVENTS_MAX_COUNT,
  DEFAULT_MAX_CONCURRENT_JOBS,
  DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT,
  MAX_CONCURRENT_JOBS,
  MIN_CONCURRENT_JOBS,
  parseJobEventsMaxCount,
  parseSessionMsgEventsMaxCount,
} from "../store/types.js";
import { exportSettings } from "../workspace/settings.js";
import {
  maskKey,
  parseQueryInt,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

const DEFAULT_ACTIVITY_MAX_COUNT = 10000;
const MIN_ACTIVITY_MAX_COUNT = 100;
const MAX_ACTIVITY_MAX_COUNT = 100000;

function parseActivityMaxCount(raw: string): number {
  const value = raw.trim();
  if (!value) return DEFAULT_ACTIVITY_MAX_COUNT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`invalid activity_logs_max_count: "${raw}"`);
  if (parsed < MIN_ACTIVITY_MAX_COUNT || parsed > MAX_ACTIVITY_MAX_COUNT) {
    throw new Error(
      `activity_logs_max_count must be between ${MIN_ACTIVITY_MAX_COUNT} and ${MAX_ACTIVITY_MAX_COUNT}`,
    );
  }
  return parsed;
}

async function getActivityMaxCount(ctx: ApiContext): Promise<number> {
  const raw = await ctx.db.getConfig("activity_logs_max_count");
  try {
    return parseActivityMaxCount(raw);
  } catch {
    return DEFAULT_ACTIVITY_MAX_COUNT;
  }
}

export async function trimActivityLogs(ctx: ApiContext): Promise<number> {
  const maxCount = await getActivityMaxCount(ctx);
  const total = await ctx.db.countActivityLogs("", "");
  if (total <= maxCount) return 0;
  const deleted = await ctx.db.trimActivityLogs(maxCount);
  if (deleted > 0) {
    const remaining = await ctx.db.countActivityLogs("", "");
    recordSync(ctx.db, {
      level: "info",
      category: "system",
      action: "logs_trimmed",
      message: `已裁剪 ${deleted} 条系统日志`,
      source: "system",
      details: { deleted_count: deleted, max_count: maxCount, remaining },
    });
  }
  return deleted;
}

function jobEventsMaxCountForResponse(stored: string): string {
  return stored.trim() ? stored : String(DEFAULT_JOB_EVENTS_MAX_COUNT);
}

function sessionMsgEventsMaxCountForResponse(stored: string): string {
  return stored.trim() ? stored : String(DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT);
}

function activityLogsMaxCountForResponse(stored: string): string {
  return stored.trim() ? stored : String(DEFAULT_ACTIVITY_MAX_COUNT);
}

function acpMaxConcurrentAgentsForResponse(stored: string): string {
  return stored.trim() ? stored : String(acpConfig.DEFAULT_MAX_CONCURRENT_AGENTS);
}

function jobParallelEnabledForResponse(stored: string): string {
  const value = stored.trim().toLowerCase();
  return value === "true" || value === "1" ? "true" : "false";
}

function jobMaxConcurrentForResponse(stored: string): string {
  return stored.trim() || String(DEFAULT_MAX_CONCURRENT_JOBS);
}

function languageForResponse(stored: string): string {
  return stored === "zh" || stored === "en" ? stored : "zh";
}

function defaultAgentKindForResponse(stored: string): string {
  return stored === acpConfig.KIND_ACP ? acpConfig.KIND_ACP : acpConfig.KIND_NATIVE;
}

function mcpServersJsonForResponse(stored: string): string {
  if (!stored.trim()) return mcpConfig.canonicalJson(mcpConfig.defaultConfig());
  try {
    return mcpConfig.canonicalJson(mcpConfig.parseConfig(stored));
  } catch {
    return stored;
  }
}

function acpAgentsJsonForResponse(stored: string): string {
  if (!stored.trim()) return acpConfig.canonicalJson(acpConfig.defaultConfig());
  try {
    return acpConfig.canonicalJson(acpConfig.parseConfig(stored));
  } catch {
    return stored;
  }
}

function apiTokenSource(ctx: ApiContext, stored: string): string {
  if (ctx.flagToken) return "flag";
  if (stored) return "settings";
  return "none";
}

function parseSettingsValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function validateApiToken(token: string): void {
  if (!token) return;
  if (token.length < 12) throw new Error("api_token must be at least 12 characters");
  if (/[ \t\r\n"']/.test(token)) throw new Error("api_token must not contain whitespace or quotes");
}

function validateAndCanonicalizeMcpJson(value: string): string {
  return mcpConfig.canonicalJson(mcpConfig.parseConfig(value));
}

function validateAndCanonicalizeAcpJson(value: string): string {
  return acpConfig.canonicalJson(acpConfig.parseConfig(value));
}

const ALLOWED_KEYS = new Set([
  "last_instance_id",
  "last_model",
  "temperature",
  "max_tokens",
  "chunk_size",
  "chunk_overlap",
  "auto_reindex",
  "watch_sources",
  "job_instance_id",
  "job_model",
  "job_parallel_enabled",
  "job_max_concurrent",
  "activity_logs_max_count",
  "ingest_job_events_max_count",
  "session_message_events_max_count",
  "mcp_servers_json",
  "ui_language",
  "doc_language",
  "rules_supplement",
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE,
  CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  "acp_agents_json",
  "default_agent_kind",
  "default_acp_agent_id",
  "acp_max_concurrent_agents",
  CONFIG_EMBEDDING_INSTANCE_ID,
  CONFIG_EMBEDDING_MODEL,
  CONFIG_EMBEDDING_DIM,
  CONFIG_API_TOKEN,
  CONFIG_ARCHIVE_INLINE_MAX_BYTES,
  CONFIG_ARCHIVE_STORAGE_BACKEND,
  CONFIG_ARCHIVE_LOCAL_DIR,
  CONFIG_ARCHIVE_S3_ENDPOINT,
  CONFIG_ARCHIVE_S3_REGION,
  CONFIG_ARCHIVE_S3_BUCKET,
  CONFIG_ARCHIVE_S3_PREFIX,
  CONFIG_ARCHIVE_S3_ACCESS_KEY_ID,
  CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY,
  CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE,
]);

export function settingsApi(ctx: ApiContext) {
  async function getSettings(c: Context): Promise<Response> {
    let all: Record<string, string>;
    try {
      all = await ctx.db.getAllConfig();
    } catch (error) {
      return writeError(c, 500, errorMessage(error));
    }
    const value = (key: string) => all[key] ?? "";
    return writeJson(c, 200, {
      last_instance_id: value("last_instance_id"),
      last_model: value("last_model"),
      job_instance_id: value("job_instance_id"),
      job_model: value("job_model"),
      job_parallel_enabled: jobParallelEnabledForResponse(value("job_parallel_enabled")),
      job_max_concurrent: jobMaxConcurrentForResponse(value("job_max_concurrent")),
      temperature: value("temperature"),
      max_tokens: value("max_tokens"),
      chunk_size: value("chunk_size"),
      chunk_overlap: value("chunk_overlap"),
      auto_reindex: value("auto_reindex"),
      watch_sources: value("watch_sources"),
      activity_logs_max_count: activityLogsMaxCountForResponse(value("activity_logs_max_count")),
      ingest_job_events_max_count: jobEventsMaxCountForResponse(value("ingest_job_events_max_count")),
      session_message_events_max_count: sessionMsgEventsMaxCountForResponse(
        value("session_message_events_max_count"),
      ),
      mcp_servers_json: mcpServersJsonForResponse(value("mcp_servers_json")),
      ui_language: languageForResponse(value("ui_language")),
      doc_language: languageForResponse(value("doc_language")),
      rules_supplement: value("rules_supplement"),
      session_tool_loop_max_rounds_ingest: sessionToolLoopMaxRoundsForResponse(
        value(CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST),
        "ingest",
      ),
      session_tool_loop_max_rounds_qa: sessionToolLoopMaxRoundsForResponse(
        value(CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA),
        "qa",
      ),
      session_tool_loop_max_rounds_organize: sessionToolLoopMaxRoundsForResponse(
        value(CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE),
        "organize",
      ),
      session_tool_loop_max_calls_per_round: sessionToolLoopMaxCallsForResponse(
        value(CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND),
      ),
      acp_agents_json: acpAgentsJsonForResponse(value("acp_agents_json")),
      default_agent_kind: defaultAgentKindForResponse(value("default_agent_kind")),
      default_acp_agent_id: value("default_acp_agent_id"),
      acp_max_concurrent_agents: acpMaxConcurrentAgentsForResponse(value("acp_max_concurrent_agents")),
      embedding_instance_id: value(CONFIG_EMBEDDING_INSTANCE_ID),
      embedding_model: value(CONFIG_EMBEDDING_MODEL),
      embedding_dim: value(CONFIG_EMBEDDING_DIM),
      embedding_configured: value(CONFIG_EMBEDDING_INSTANCE_ID) !== "" && value(CONFIG_EMBEDDING_MODEL) !== "",
      api_token_set: value(CONFIG_API_TOKEN) !== "",
      api_token_masked: maskKey(value(CONFIG_API_TOKEN)),
      api_token_source: apiTokenSource(ctx, value(CONFIG_API_TOKEN)),
      archive_inline_max_bytes:
        value(CONFIG_ARCHIVE_INLINE_MAX_BYTES).trim() || String(DEFAULT_ARCHIVE_INLINE_MAX_BYTES),
      archive_storage_backend:
        value(CONFIG_ARCHIVE_STORAGE_BACKEND).trim().toLowerCase() === "s3" ? "s3" : "local",
      archive_local_dir: value(CONFIG_ARCHIVE_LOCAL_DIR),
      archive_local_dir_effective:
        value(CONFIG_ARCHIVE_LOCAL_DIR).trim() || defaultArchiveLocalDir(ctx.workspace),
      archive_s3_endpoint: value(CONFIG_ARCHIVE_S3_ENDPOINT),
      archive_s3_region: value(CONFIG_ARCHIVE_S3_REGION) || "us-east-1",
      archive_s3_bucket: value(CONFIG_ARCHIVE_S3_BUCKET),
      archive_s3_prefix: value(CONFIG_ARCHIVE_S3_PREFIX),
      archive_s3_force_path_style:
        value(CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE).trim().toLowerCase() === "true",
      archive_s3_access_key_id_set: value(CONFIG_ARCHIVE_S3_ACCESS_KEY_ID) !== "",
      archive_s3_access_key_id_masked: maskKey(value(CONFIG_ARCHIVE_S3_ACCESS_KEY_ID)),
      archive_s3_secret_access_key_set: value(CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY) !== "",
      archive_s3_secret_access_key_masked: maskKey(value(CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY)),
    });
  }

  return {
    getSettings,

    async updateSettings(c: Context): Promise<Response> {
      const req = await readJsonBody<Record<string, unknown>>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (
        isApiKeyRequest(c) &&
        (CONFIG_API_TOKEN in req ||
          CONFIG_ARCHIVE_S3_ACCESS_KEY_ID in req ||
          CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY in req)
      ) {
        return writeError(c, 403, "api key cannot manage credentials");
      }

      let pendingAcpJson = "";
      if ("acp_agents_json" in req) {
        const value = parseSettingsValue(req.acp_agents_json);
        try {
          pendingAcpJson = validateAndCanonicalizeAcpJson(value);
        } catch (error) {
          return writeError(c, 400, errorMessage(error));
        }
      }
      if ("default_agent_kind" in req) {
        const value = parseSettingsValue(req.default_agent_kind);
        if (value !== acpConfig.KIND_NATIVE && value !== acpConfig.KIND_ACP) {
          return writeError(c, 400, "default_agent_kind must be native or acp");
        }
      }
      if ("acp_max_concurrent_agents" in req) {
        const value = parseSettingsValue(req.acp_max_concurrent_agents);
        const parsed = Number.parseInt(value, 10);
        if (
          !Number.isFinite(parsed) ||
          parsed < acpConfig.MIN_CONCURRENT_AGENTS ||
          parsed > acpConfig.MAX_CONCURRENT_AGENTS
        ) {
          return writeError(c, 400, "acp_max_concurrent_agents must be between 1 and 16");
        }
      }
      if ("default_acp_agent_id" in req) {
        const value = parseSettingsValue(req.default_acp_agent_id);
        if (value.trim()) {
          const effectiveJson =
            pendingAcpJson || (await ctx.db.getConfig("acp_agents_json"));
          let cfg;
          try {
            cfg = acpConfig.parseConfig(effectiveJson);
          } catch (error) {
            return writeError(c, 400, errorMessage(error));
          }
          if (!acpConfig.getAgent(cfg, value)) {
            return writeError(c, 400, "default_acp_agent_id references an unknown agent");
          }
        }
      }

      for (const [key, raw] of Object.entries(req)) {
        if (!ALLOWED_KEYS.has(key)) continue;
        let value: string;
        try {
          value = parseSettingsValue(raw);
          if (key === "activity_logs_max_count") parseActivityMaxCount(value);
          if (key === "ingest_job_events_max_count") parseJobEventsMaxCount(value);
          if (key === "session_message_events_max_count") parseSessionMsgEventsMaxCount(value);
          if (key === "mcp_servers_json") value = validateAndCanonicalizeMcpJson(value);
          if (key === "acp_agents_json") value = pendingAcpJson;
          if ((key === "ui_language" || key === "doc_language") && value !== "zh" && value !== "en") {
            throw new Error(`${key} must be 'zh' or 'en`);
          }
          if (key === "rules_supplement") validateRulesSupplement(value);
          if (
            key === CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST ||
            key === CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA ||
            key === CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE
          ) {
            parseToolLoopMaxRounds(value);
          }
          if (key === CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND) parseToolLoopMaxCallsPerRound(value);
          if (key === CONFIG_EMBEDDING_DIM && value !== "") {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed) || parsed < 1 || parsed > 8192) {
              throw new Error("embedding_dim must be an integer between 1 and 8192");
            }
          }
          if (key === CONFIG_API_TOKEN) {
            value = value.trim();
            validateApiToken(value);
          }
          if (key === CONFIG_ARCHIVE_INLINE_MAX_BYTES) {
            value = String(parseArchiveInlineMaxBytes(value));
          }
          if (key === CONFIG_ARCHIVE_STORAGE_BACKEND) {
            value = value.trim().toLowerCase() || "local";
            if (value !== "local" && value !== "s3") {
              throw new Error("archive_storage_backend must be 'local' or 's3'");
            }
          }
          if (key === CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE) {
            value = value.trim().toLowerCase() === "true" || value.trim() === "1" ? "true" : "false";
          }
          if (key === "job_parallel_enabled") {
            const flag = value.trim().toLowerCase();
            if (flag !== "true" && flag !== "false" && flag !== "1" && flag !== "0") {
              throw new Error("job_parallel_enabled must be true or false");
            }
            value = flag === "true" || flag === "1" ? "true" : "false";
          }
          if (key === "job_max_concurrent") {
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < MIN_CONCURRENT_JOBS || parsed > MAX_CONCURRENT_JOBS) {
              throw new Error(
                `job_max_concurrent must be an integer between ${MIN_CONCURRENT_JOBS} and ${MAX_CONCURRENT_JOBS}`,
              );
            }
            value = String(parsed);
          }
          if (
            (key === CONFIG_ARCHIVE_S3_ACCESS_KEY_ID || key === CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY) &&
            !value.trim()
          ) {
            // Keep existing secret when form leaves password field blank unless explicitly cleared via separate action.
            continue;
          }
        } catch (error) {
          return writeError(c, 400, errorMessage(error));
        }
        try {
          await ctx.db.setConfig(key, value);
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }

      if ("activity_logs_max_count" in req) {
        try {
          await trimActivityLogs(ctx);
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }
      if ("ingest_job_events_max_count" in req) {
        try {
          const maxN = parseJobEventsMaxCount(parseSettingsValue(req.ingest_job_events_max_count));
          await ctx.db.trimAllIngestJobEvents(maxN);
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }

      if (ctx.workspace) {
        try {
          await exportSettings(ctx.db, ctx.workspace);
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }
      return getSettings(c);
    },

    async updateLastModel(c: Context): Promise<Response> {
      const req = await readJsonBody<{ instance_id?: string; model?: string }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!req.instance_id || !req.model) {
        return writeError(c, 400, "instance_id and model are required");
      }
      try {
        await ctx.db.setConfig("last_instance_id", req.instance_id);
        await ctx.db.setConfig("last_model", req.model);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
      return writeJson(c, 200, {
        last_instance_id: req.instance_id,
        last_model: req.model,
      });
    },

    async listActivityLogs(c: Context): Promise<Response> {
      const limit = parseQueryInt(c, "limit", 50);
      const offset = parseQueryInt(c, "offset", 0);
      const category = c.req.query("category") ?? "";
      const level = c.req.query("level") ?? "";
      try {
        const logs = await ctx.db.listActivityLogs({ limit, offset, category, level });
        const total = await ctx.db.countActivityLogs(category, level);
        return writeJson(c, 200, {
          logs,
          total,
          limit,
          offset,
          has_more: offset + logs.length < total,
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async deleteAllActivityLogs(c: Context): Promise<Response> {
      try {
        const deleted = await ctx.db.deleteAllActivityLogs();
        await recordSync(ctx.db, {
          level: "info",
          category: "system",
          action: "logs_cleared",
          message: "已清空全部系统日志",
          source: "api",
          details: { deleted_count: deleted },
        });
        return writeJson(c, 200, { deleted_count: deleted });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async checkMcpStatus(c: Context): Promise<Response> {
      let raw = "";
      const body = await readJsonBody<{ mcp_servers_json?: string }>(c);
      if (body) raw = body.mcp_servers_json ?? "";
      if (!raw.trim()) {
        try {
          raw = await ctx.db.getConfig("mcp_servers_json");
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }
      let cfg;
      try {
        cfg = mcpConfig.parseConfig(raw);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      const { checkServers } = await import("../mcp/check.js");
      return writeJson(c, 200, { servers: await checkServers(cfg, c.req.raw.signal) });
    },

    async listAcpAgents(c: Context): Promise<Response> {
      let raw: string;
      try {
        raw = await ctx.db.getConfig("acp_agents_json");
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
      let cfg;
      try {
        cfg = acpConfig.parseConfig(raw);
      } catch (error) {
        return writeJson(c, 200, { agents: [], config_error: errorMessage(error) });
      }
      const { availability } = await import("../acp/check.js");
      const statuses = await availability(cfg);
      const agents = acpConfig
        .redactedAgents(cfg)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((agent) => ({
          ...agent,
          available: statuses[agent.id]?.available ?? false,
          unavailable_reason: statuses[agent.id]?.reason ?? "",
        }));
      return writeJson(c, 200, { agents });
    },

    async checkAcpAgents(c: Context): Promise<Response> {
      let raw = "";
      const body = await readJsonBody<{ acp_agents_json?: string }>(c);
      if (body) raw = body.acp_agents_json ?? "";
      if (!raw.trim()) {
        try {
          raw = await ctx.db.getConfig("acp_agents_json");
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }
      let cfg;
      try {
        cfg = acpConfig.parseConfig(raw);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      const { checkAgents } = await import("../acp/check.js");
      return writeJson(c, 200, { agents: await checkAgents(cfg, ctx.workspace) });
    },

    async checkArchiveStorage(c: Context): Promise<Response> {
      const body = (await readJsonBody<Record<string, unknown>>(c)) ?? {};
      const override: Record<string, string> = {};
      if (!isApiKeyRequest(c)) {
        const candidateKeys = [
          CONFIG_ARCHIVE_STORAGE_BACKEND,
          CONFIG_ARCHIVE_LOCAL_DIR,
          CONFIG_ARCHIVE_S3_ENDPOINT,
          CONFIG_ARCHIVE_S3_REGION,
          CONFIG_ARCHIVE_S3_BUCKET,
          CONFIG_ARCHIVE_S3_PREFIX,
          CONFIG_ARCHIVE_S3_ACCESS_KEY_ID,
          CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY,
          CONFIG_ARCHIVE_S3_FORCE_PATH_STYLE,
        ];
        for (const key of candidateKeys) {
          if (key in body && body[key] !== undefined && body[key] !== null) {
            const parsed = parseSettingsValue(body[key]);
            if (
              (key === CONFIG_ARCHIVE_S3_ACCESS_KEY_ID || key === CONFIG_ARCHIVE_S3_SECRET_ACCESS_KEY) &&
              !parsed.trim()
            ) {
              continue;
            }
            override[key] = parsed;
          }
        }
      }
      try {
        const storage = new ArchiveStorageService(ctx.db, ctx.workspace);
        const result = await storage.checkConnectivity(override);
        return writeJson(c, 200, result);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
