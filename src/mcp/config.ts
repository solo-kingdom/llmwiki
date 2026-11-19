export const CONFIG_VERSION = 1;
export const DEFAULT_READONLY_ONLY = true;
export const DEFAULT_FALLBACK_MODE = "local_only";
export const DEFAULT_TOOL_SEARCH = "search";
export const DEFAULT_TOOL_READ = "read";
export const DEFAULT_TOOL_WEB_FETCH = "web_fetch";
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 300000;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_RETRY_COUNT = 5;
export const MAX_BACKOFF_MS = 60000;

const VALID_TRANSPORTS = new Set(["sse", "streamable-http", "stdio"]);

const WRITE_TOOL_NAMES = new Set([
  "create",
  "edit",
  "append",
  "delete",
  "write",
  "update",
  "remove",
]);

const READONLY_TOOL_NAMES = new Set([DEFAULT_TOOL_SEARCH, DEFAULT_TOOL_READ]);

export interface RetryConfig {
  max: number;
  backoff_ms: number;
}

export interface ScopeConfig {
  job: boolean;
  chat: boolean;
}

export interface ServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: string;
  url: string;
  headers?: Record<string, string>;
  timeout_ms: number;
  retry: RetryConfig;
  scope: ScopeConfig;
  allowed_tools?: string[];
  allow_write_tools?: boolean;
}

export interface McpDefaults {
  readonly_only: boolean;
  fallback_mode: string;
}

export interface McpConfig {
  version: number;
  servers: Record<string, ServerConfig>;
  defaults: McpDefaults;
}

export class ValidationError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(path ? `${path}: ${detail}` : detail);
    this.name = "ValidationError";
  }
}

function ve(path: string, message: string): ValidationError {
  return new ValidationError(path, message);
}

export function defaultConfig(): McpConfig {
  return {
    version: CONFIG_VERSION,
    servers: {},
    defaults: { readonly_only: DEFAULT_READONLY_ONLY, fallback_mode: DEFAULT_FALLBACK_MODE },
  };
}

export function parseConfig(raw: string): McpConfig {
  const trimmed = raw.trim();
  if (!trimmed) return defaultConfig();

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (error) {
    throw ve("", `invalid JSON: ${errorMessage(error)}`);
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw ve("", "invalid JSON: expected an object");
  }

  const servers = parseServersJson(envelope["servers"]);
  const rawDefaults =
    envelope["defaults"] && typeof envelope["defaults"] === "object"
      ? (envelope["defaults"] as Record<string, unknown>)
      : {};

  const cfg: McpConfig = {
    version: typeof envelope["version"] === "number" ? envelope["version"] : 0,
    servers,
    defaults: {
      fallback_mode: typeof rawDefaults["fallback_mode"] === "string" ? rawDefaults["fallback_mode"] : "",
      readonly_only:
        typeof rawDefaults["readonly_only"] === "boolean"
          ? rawDefaults["readonly_only"]
          : DEFAULT_READONLY_ONLY,
    },
  };
  validateConfig(cfg);
  applyDefaultsAfterParse(cfg, typeof rawDefaults["readonly_only"] === "boolean" ? rawDefaults["readonly_only"] : null);
  return cfg;
}

function parseServersJson(raw: unknown): Record<string, ServerConfig> {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw)) {
    return serversArrayToMap(raw.map((item, index) => parseServer(item, `servers[${index}]`)));
  }
  if (typeof raw === "object") {
    const result: Record<string, ServerConfig> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const id = key.trim();
      if (!id) throw ve("servers", "empty server key");
      const server = parseServer(value, `servers.${id}`);
      if (!server.id) server.id = id;
      else if (server.id !== id) throw ve(`servers.${id}.id`, `must match map key ${JSON.stringify(id)}`);
      result[id] = server;
    }
    return result;
  }
  throw ve("servers", "must be an object keyed by server id");
}

function serversArrayToMap(servers: ServerConfig[]): Record<string, ServerConfig> {
  const result: Record<string, ServerConfig> = {};
  servers.forEach((server, index) => {
    const id = server.id.trim();
    if (!id) throw ve(`servers[${index}].id`, "is required");
    if (result[id]) throw ve(`servers[${index}].id`, `duplicate id ${JSON.stringify(id)}`);
    server.id = id;
    result[id] = server;
  });
  return result;
}

function parseServer(raw: unknown, p: string): ServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw ve(p, "invalid object");
  const fields = raw as Record<string, unknown>;
  const retry = (fields["retry"] && typeof fields["retry"] === "object" ? fields["retry"] : {}) as Record<
    string,
    unknown
  >;
  const scope = (fields["scope"] && typeof fields["scope"] === "object" ? fields["scope"] : {}) as Record<
    string,
    unknown
  >;
  return {
    id: asString(fields["id"]),
    name: asString(fields["name"]),
    enabled: fields["enabled"] === true,
    transport: asString(fields["transport"]),
    url: asString(fields["url"]),
    headers: asStringRecord(fields["headers"]),
    timeout_ms: asNumber(fields["timeout_ms"]),
    retry: { max: asNumber(retry["max"]), backoff_ms: asNumber(retry["backoff_ms"]) },
    scope: { job: scope["job"] === true, chat: scope["chat"] === true },
    allowed_tools: asStringArray(fields["allowed_tools"]),
    allow_write_tools: fields["allow_write_tools"] === true,
  };
}

export function validateConfig(cfg: McpConfig): void {
  if (!cfg) throw ve("", "config is nil");
  if (cfg.version !== CONFIG_VERSION) throw ve("version", `must be ${CONFIG_VERSION}`);
  if (cfg.defaults.fallback_mode && cfg.defaults.fallback_mode !== DEFAULT_FALLBACK_MODE) {
    throw ve("defaults.fallback_mode", "must be local_only");
  }
  for (const [key, server] of Object.entries(cfg.servers)) {
    const prefix = `servers.${key}`;
    if (!key.trim()) throw ve("servers", "empty server key");
    if (!server.id.trim()) server.id = key;
    else if (server.id !== key) throw ve(`${prefix}.id`, `must match map key ${JSON.stringify(key)}`);
    validateServer(server, prefix, cfg.defaults.readonly_only);
  }
}

function validateServer(server: ServerConfig, prefix: string, readonlyOnly: boolean): void {
  if (!server.id.trim()) throw ve(`${prefix}.id`, "is required");
  if (!server.name.trim()) throw ve(`${prefix}.name`, "is required");
  const transport = server.transport.trim();
  if (!VALID_TRANSPORTS.has(transport)) {
    throw ve(`${prefix}.transport`, "must be one of: sse, streamable-http, stdio");
  }
  if (transport !== "stdio" && !server.url.trim()) {
    throw ve(`${prefix}.url`, `is required for ${transport}`);
  }
  if (server.timeout_ms !== 0 && (server.timeout_ms < MIN_TIMEOUT_MS || server.timeout_ms > MAX_TIMEOUT_MS)) {
    throw ve(`${prefix}.timeout_ms`, `must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  if (server.retry.max < 0 || server.retry.max > MAX_RETRY_COUNT) {
    throw ve(`${prefix}.retry.max`, `must be between 0 and ${MAX_RETRY_COUNT}`);
  }
  if (server.retry.backoff_ms < 0 || server.retry.backoff_ms > MAX_BACKOFF_MS) {
    throw ve(`${prefix}.retry.backoff_ms`, `must be between 0 and ${MAX_BACKOFF_MS}`);
  }
  const tools =
    server.allowed_tools && server.allowed_tools.length > 0
      ? server.allowed_tools
      : readonlyOnly
        ? [DEFAULT_TOOL_SEARCH, DEFAULT_TOOL_READ]
        : [];
  for (const tool of tools) {
    if (isWriteToolName(tool) && readonlyOnly && !server.allow_write_tools) {
      throw ve(
        `${prefix}.allowed_tools`,
        `write tool ${JSON.stringify(tool)} requires allow_write_tools=true when defaults.readonly_only is true`,
      );
    }
  }
}

export function normalizeConfig(cfg: McpConfig): void {
  if (!cfg) return;
  cfg.servers ??= {};
  if (!cfg.version) cfg.version = CONFIG_VERSION;
  if (!cfg.defaults.fallback_mode) cfg.defaults.fallback_mode = DEFAULT_FALLBACK_MODE;
}

export function applyDefaultsAfterParse(cfg: McpConfig, rawReadonly: boolean | null): void {
  if (!cfg) return;
  if (rawReadonly === null) cfg.defaults.readonly_only = DEFAULT_READONLY_ONLY;
  if (!cfg.defaults.fallback_mode) cfg.defaults.fallback_mode = DEFAULT_FALLBACK_MODE;
  for (const [id, server] of Object.entries(cfg.servers)) {
    if (server.timeout_ms <= 0) server.timeout_ms = DEFAULT_TIMEOUT_MS;
    if (!server.allowed_tools || server.allowed_tools.length === 0) {
      if (cfg.defaults.readonly_only) {
        server.allowed_tools = [DEFAULT_TOOL_SEARCH, DEFAULT_TOOL_READ];
      }
    }
    cfg.servers[id] = server;
  }
}

export function isWriteToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (WRITE_TOOL_NAMES.has(normalized)) return true;
  for (const word of WRITE_TOOL_NAMES) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

export function isReadonlyTool(name: string): boolean {
  return READONLY_TOOL_NAMES.has(name.trim().toLowerCase());
}

export function canonicalJson(cfg: McpConfig | null | undefined): string {
  const value = cfg ?? defaultConfig();
  normalizeConfig(value);
  applyDefaultsAfterParse(value, null);
  return JSON.stringify(normalizeForJson(value), null, 2);
}

function normalizeForJson(cfg: McpConfig): McpConfig {
  const servers: Record<string, ServerConfig> = {};
  for (const id of Object.keys(cfg.servers).sort()) {
    const server = cfg.servers[id]!;
    servers[id] = {
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
      timeout_ms: server.timeout_ms,
      retry: { max: server.retry.max, backoff_ms: server.retry.backoff_ms },
      scope: { job: server.scope.job, chat: server.scope.chat },
      ...(server.allowed_tools ? { allowed_tools: server.allowed_tools } : {}),
      ...(server.allow_write_tools ? { allow_write_tools: true } : {}),
    };
  }
  return {
    version: cfg.version,
    servers,
    defaults: {
      readonly_only: cfg.defaults.readonly_only,
      fallback_mode: cfg.defaults.fallback_mode,
    },
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
