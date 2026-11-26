import {
  defaultHarnixSettings,
  normalizeHarnixSettings,
  type AcpAgentEntry,
  type AcpHarnessSettings,
  type HarnixSettings,
  type HarnessKind,
  type HarnessProviderCredentials,
} from "harnix";
import {
  CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST,
} from "../mcp/tool_loop_settings.js";
import type { Store } from "../store/interfaces.js";

export const CONFIG_HARNIX_SETTINGS = "harnix_settings_json";

export function legacyAcpJsonToAcpSettings(
  raw: string,
  defaultAgentId: string,
  maxConcurrent: number,
): AcpHarnessSettings {
  const defaults = defaultHarnixSettings().acp;
  const trimmed = raw.trim();
  const parsedMax =
    Number.isFinite(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 16
      ? maxConcurrent
      : defaults.maxConcurrentSessions;

  if (!trimmed) {
    return {
      ...defaults,
      defaultAgentId,
      maxConcurrentSessions: parsedMax,
    };
  }

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("acp_agents_json must be a JSON object");
  }

  const rawDefaults =
    parsed["defaults"] && typeof parsed["defaults"] === "object"
      ? (parsed["defaults"] as Record<string, unknown>)
      : {};
  const rawAgents =
    parsed["agents"] && typeof parsed["agents"] === "object" && !Array.isArray(parsed["agents"])
      ? (parsed["agents"] as Record<string, unknown>)
      : {};

  const agents: Record<string, AcpAgentEntry> = {};
  for (const [id, value] of Object.entries(rawAgents)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`agents.${id}: invalid object`);
    }
    const obj = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, "env")) {
      throw new Error(`agents.${id}.env: 配置不接受环境变量值，请用 env_passthrough 只声明变量名`);
    }
    const perm =
      obj["permission"] && typeof obj["permission"] === "object"
        ? (obj["permission"] as Record<string, unknown>)
        : {};
    const cwdPolicy = obj["cwd_policy"] === "session" ? "session" : "workspace";
    agents[id] = {
      id: typeof obj["id"] === "string" ? obj["id"] : id,
      name: typeof obj["name"] === "string" ? obj["name"] : "",
      enabled: obj["enabled"] === true,
      command: typeof obj["command"] === "string" ? obj["command"] : "",
      args: Array.isArray(obj["args"])
        ? obj["args"].filter((item): item is string => typeof item === "string")
        : [],
      envPassthrough: Array.isArray(obj["env_passthrough"])
        ? obj["env_passthrough"].filter((item): item is string => typeof item === "string")
        : ["PATH", "HOME", "LANG"],
      cwdPolicy,
      initTimeoutMs:
        typeof obj["init_timeout_ms"] === "number" && obj["init_timeout_ms"] > 0
          ? obj["init_timeout_ms"]
          : 30_000,
      promptTimeoutMs:
        typeof obj["prompt_timeout_ms"] === "number" && obj["prompt_timeout_ms"] > 0
          ? obj["prompt_timeout_ms"]
          : 600_000,
      idleTimeoutMs:
        typeof obj["idle_timeout_ms"] === "number" && obj["idle_timeout_ms"] > 0
          ? obj["idle_timeout_ms"]
          : 120_000,
      permission: {
        mode: "auto",
        allowRead: perm["allow_read"] === true,
        allowSearch: perm["allow_search"] === true,
        allowFetch: perm["allow_fetch"] === true,
        allowWrite: perm["allow_write"] === true,
        allowExecute: perm["allow_execute"] === true,
      },
    };
  }

  return {
    defaultAgentId,
    maxConcurrentSessions: parsedMax,
    defaults: {
      readonlyOnly:
        typeof rawDefaults["readonly_only"] === "boolean" ? rawDefaults["readonly_only"] : true,
      onUnavailable: "error",
    },
    agents,
  };
}

export function acpSettingsToLegacyAcpJson(acp: AcpHarnessSettings): string {
  const agents: Record<string, unknown> = {};
  for (const id of Object.keys(acp.agents).sort()) {
    const a = acp.agents[id]!;
    agents[id] = {
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      command: a.command,
      ...(a.args.length > 0 ? { args: [...a.args] } : {}),
      env_passthrough: [...a.envPassthrough],
      cwd_policy: a.cwdPolicy,
      init_timeout_ms: a.initTimeoutMs,
      prompt_timeout_ms: a.promptTimeoutMs,
      idle_timeout_ms: a.idleTimeoutMs,
      permission: {
        mode: a.permission.mode,
        allow_read: a.permission.allowRead,
        allow_search: a.permission.allowSearch,
        allow_fetch: a.permission.allowFetch,
        allow_write: a.permission.allowWrite,
        allow_execute: a.permission.allowExecute,
      },
    };
  }
  return JSON.stringify(
    {
      version: 1,
      agents,
      defaults: {
        readonly_only: acp.defaults.readonlyOnly,
        on_unavailable: acp.defaults.onUnavailable,
      },
    },
    null,
    2,
  );
}

function parseIntOr(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function loadHarnixSettings(db: Store): Promise<HarnixSettings> {
  const stored = await db.getConfig(CONFIG_HARNIX_SETTINGS);
  if (stored.trim()) {
    return normalizeHarnixSettings(stored);
  }

  const defaults = defaultHarnixSettings();
  const [
    rawDefaultKind,
    rawDefaultAcpAgentId,
    rawAcpJson,
    rawMaxConcurrent,
    rawMaxRounds,
    rawMaxCallsPerRound,
    rawTemp,
    rawMaxTokens,
  ] = await Promise.all([
    db.getConfig("default_agent_kind"),
    db.getConfig("default_acp_agent_id"),
    db.getConfig("acp_agents_json"),
    db.getConfig("acp_max_concurrent_agents"),
    db.getConfig(CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST),
    db.getConfig(CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND),
    db.getConfig("temperature"),
    db.getConfig("max_tokens"),
  ]);

  const defaultKind: HarnessKind =
    rawDefaultKind === "pi" || rawDefaultKind === "acp" ? rawDefaultKind : "native";
  const maxTurns = Math.min(64, Math.max(1, parseIntOr(rawMaxRounds, defaults.native.maxTurns)));
  const maxToolCallsPerTurn = Math.min(
    32,
    Math.max(1, parseIntOr(rawMaxCallsPerRound, defaults.native.maxToolCallsPerTurn)),
  );
  const temperature = parseFloatOrUndefined(rawTemp);
  const maxTokens = parseIntOr(rawMaxTokens, 0) || undefined;
  const maxConcurrent = parseIntOr(rawMaxConcurrent, defaults.acp.maxConcurrentSessions);

  let acp = defaults.acp;
  try {
    acp = legacyAcpJsonToAcpSettings(rawAcpJson, rawDefaultAcpAgentId.trim(), maxConcurrent);
  } catch {
    acp = { ...defaults.acp, defaultAgentId: rawDefaultAcpAgentId.trim(), maxConcurrentSessions: maxConcurrent };
  }

  return normalizeHarnixSettings({
    version: 1,
    defaultKind,
    native: {
      ...defaults.native,
      maxTurns,
      maxToolCallsPerTurn,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
    pi: {
      ...defaults.pi,
      maxTurns,
      maxToolCallsPerTurn,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
    acp,
  });
}

export async function saveHarnixSettings(db: Store, input: unknown): Promise<HarnixSettings> {
  const normalized = normalizeHarnixSettings(input);
  await db.setConfig(CONFIG_HARNIX_SETTINGS, JSON.stringify(normalized));
  await db.setConfig("default_agent_kind", normalized.defaultKind);
  await db.setConfig("default_acp_agent_id", normalized.acp.defaultAgentId);
  await db.setConfig("acp_agents_json", acpSettingsToLegacyAcpJson(normalized.acp));
  await db.setConfig("acp_max_concurrent_agents", String(normalized.acp.maxConcurrentSessions));
  return normalized;
}

export function hasEnabledAcpAgent(settings: HarnixSettings): boolean {
  return Object.values(settings.acp.agents).some((agent) => agent.enabled);
}

export async function resolveProviderCredentials(
  db: Store,
  instanceId: string,
  model: string,
): Promise<HarnessProviderCredentials> {
  const instance = instanceId.trim();
  const modelId = model.trim();
  if (!instance || !modelId) {
    throw new Error(
      "provider instance and model are not configured; set them in Settings under Provider instances",
    );
  }

  const providerInstance = await db.getProviderInstance(instance);
  if (!providerInstance) {
    throw new Error(
      `provider instance "${instance}" not found; configure it in Settings under Provider instances`,
    );
  }
  const providerInfo = await db.getProviderInfo(providerInstance.catalog_id);
  const apiFormat = providerInstance.api_format.trim() || providerInfo?.api_format || "openai";
  const baseUrl = providerInstance.base_url.trim() || providerInfo?.api_base || "";

  if (apiFormat !== "ollama" && !providerInstance.api_key.trim()) {
    const name = providerInstance.name || instance;
    throw new Error(
      `API key is not configured for provider instance "${name}"; set it in Settings under Provider instances`,
    );
  }

  return {
    kind: apiFormat === "anthropic" ? "anthropic" : "openai-compatible",
    baseUrl,
    apiKey: providerInstance.api_key,
    model: modelId,
  };
}
