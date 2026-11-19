import path from "node:path";

export const CONFIG_VERSION = 1;
export const KIND_NATIVE = "native";
export const KIND_ACP = "acp";
export const DEFAULT_CWD_POLICY = "workspace";
export const DEFAULT_INIT_TIMEOUT_MS = 30000;
export const DEFAULT_PROMPT_TIMEOUT_MS = 600000;
export const DEFAULT_IDLE_TIMEOUT_MS = 120000;
export const DEFAULT_READONLY_ONLY = true;
export const DEFAULT_ON_UNAVAILABLE = "error";
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;

export const MIN_INIT_TIMEOUT_MS = 1000;
export const MAX_INIT_TIMEOUT_MS = 120000;
export const MIN_PROMPT_TIMEOUT_MS = 5000;
export const MAX_PROMPT_TIMEOUT_MS = 3600000;
export const MIN_IDLE_TIMEOUT_MS = 5000;
export const MAX_IDLE_TIMEOUT_MS = 600000;

export const MIN_CONCURRENT_AGENTS = 1;
export const MAX_CONCURRENT_AGENTS = 16;

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PermissionPolicy {
  mode: string;
  allow_read: boolean;
  allow_search: boolean;
  allow_fetch: boolean;
  allow_write: boolean;
  allow_execute: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  args?: string[];
  env_passthrough?: string[];
  cwd_policy: string;
  init_timeout_ms: number;
  prompt_timeout_ms: number;
  idle_timeout_ms: number;
  permission: PermissionPolicy;
}

export interface AcpDefaults {
  readonly_only: boolean;
  on_unavailable: string;
}

export interface AcpConfig {
  version: number;
  agents: Record<string, AgentConfig>;
  defaults: AcpDefaults;
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

export function defaultPermissionPolicy(): PermissionPolicy {
  return {
    mode: "",
    allow_read: false,
    allow_search: false,
    allow_fetch: false,
    allow_write: false,
    allow_execute: false,
  };
}

export function defaultAgentConfig(id = ""): AgentConfig {
  return {
    id,
    name: "",
    enabled: false,
    command: "",
    args: [],
    env_passthrough: [],
    cwd_policy: "",
    init_timeout_ms: 0,
    prompt_timeout_ms: 0,
    idle_timeout_ms: 0,
    permission: defaultPermissionPolicy(),
  };
}

export function defaultConfig(): AcpConfig {
  return {
    version: CONFIG_VERSION,
    agents: {},
    defaults: {
      readonly_only: DEFAULT_READONLY_ONLY,
      on_unavailable: DEFAULT_ON_UNAVAILABLE,
    },
  };
}

export function parseConfig(raw: string): AcpConfig {
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

  const agents = parseAgents(envelope["agents"]);
  const cfg: AcpConfig = {
    version: typeof envelope["version"] === "number" ? envelope["version"] : 0,
    agents,
    defaults: { readonly_only: DEFAULT_READONLY_ONLY, on_unavailable: "" },
  };

  const rawDefaults = envelope["defaults"];
  if (rawDefaults !== undefined && rawDefaults !== null) {
    if (typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
      throw ve("defaults", "invalid object");
    }
    const defaults = rawDefaults as Record<string, unknown>;
    if (typeof defaults["readonly_only"] === "boolean") {
      cfg.defaults.readonly_only = defaults["readonly_only"];
    }
    if (typeof defaults["on_unavailable"] === "string") {
      cfg.defaults.on_unavailable = defaults["on_unavailable"];
    }
  }

  validateConfig(cfg);
  applyDefaultsAfterParse(cfg);
  return cfg;
}

function parseAgents(raw: unknown): Record<string, AgentConfig> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw ve("agents", "must be an object keyed by agent id");
  }
  const agents: Record<string, AgentConfig> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) throw ve("agents", "empty agent key");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw ve(`agents.${id}`, "invalid object");
    }
    const fields = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(fields, "env")) {
      throw ve(
        `agents.${id}.env`,
        "配置不接受环境变量值，请用 env_passthrough 只声明变量名",
      );
    }
    agents[id] = parseAgent(fields);
  }
  return agents;
}

function parseAgent(fields: Record<string, unknown>): AgentConfig {
  const permissionRaw =
    fields["permission"] && typeof fields["permission"] === "object"
      ? (fields["permission"] as Record<string, unknown>)
      : {};
  return {
    id: asString(fields["id"]),
    name: asString(fields["name"]),
    enabled: fields["enabled"] === true,
    command: asString(fields["command"]),
    args: asStringArray(fields["args"]),
    env_passthrough: asStringArray(fields["env_passthrough"]),
    cwd_policy: asString(fields["cwd_policy"]),
    init_timeout_ms: asNumber(fields["init_timeout_ms"]),
    prompt_timeout_ms: asNumber(fields["prompt_timeout_ms"]),
    idle_timeout_ms: asNumber(fields["idle_timeout_ms"]),
    permission: {
      mode: asString(permissionRaw["mode"]),
      allow_read: permissionRaw["allow_read"] === true,
      allow_search: permissionRaw["allow_search"] === true,
      allow_fetch: permissionRaw["allow_fetch"] === true,
      allow_write: permissionRaw["allow_write"] === true,
      allow_execute: permissionRaw["allow_execute"] === true,
    },
  };
}

export function validateConfig(cfg: AcpConfig): void {
  if (!cfg) throw ve("", "config is nil");
  if (cfg.version !== CONFIG_VERSION) throw ve("version", `must be ${CONFIG_VERSION}`);
  if (cfg.defaults.on_unavailable && cfg.defaults.on_unavailable !== DEFAULT_ON_UNAVAILABLE) {
    throw ve("defaults.on_unavailable", "must be error");
  }
  for (const [id, agent] of Object.entries(cfg.agents)) {
    if (!id.trim()) throw ve("agents", "empty agent key");
    const prefix = `agents.${id}`;
    if (!agent.id) throw ve(`${prefix}.id`, `must match map key ${JSON.stringify(id)}`);
    if (agent.id !== id) throw ve(`${prefix}.id`, `must match map key ${JSON.stringify(id)}`);
    if (!agent.name.trim()) throw ve(`${prefix}.name`, "is required");
    validateCommand(agent.command, `${prefix}.command`);
    validateArgsNoCredentials(id, agent.args ?? []);
    const seenEnv = new Set<string>();
    (agent.env_passthrough ?? []).forEach((name, index) => {
      const p = `${prefix}.env_passthrough[${index}]`;
      if (!name) throw ve(p, "environment variable name is required");
      if (!ENV_NAME_PATTERN.test(name)) throw ve(p, "must match ^[A-Za-z_][A-Za-z0-9_]*$");
      if (seenEnv.has(name)) throw ve(p, `duplicate environment variable name ${JSON.stringify(name)}`);
      seenEnv.add(name);
    });
    if (agent.cwd_policy && agent.cwd_policy !== "workspace" && agent.cwd_policy !== "session") {
      throw ve(`${prefix}.cwd_policy`, "must be workspace or session");
    }
    validateTimeout(agent.init_timeout_ms, MIN_INIT_TIMEOUT_MS, MAX_INIT_TIMEOUT_MS, `${prefix}.init_timeout_ms`);
    validateTimeout(
      agent.prompt_timeout_ms,
      MIN_PROMPT_TIMEOUT_MS,
      MAX_PROMPT_TIMEOUT_MS,
      `${prefix}.prompt_timeout_ms`,
    );
    validateTimeout(agent.idle_timeout_ms, MIN_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS, `${prefix}.idle_timeout_ms`);
    if (agent.permission.mode && agent.permission.mode !== "auto") {
      throw ve(`${prefix}.permission.mode`, "must be auto");
    }
    if (cfg.defaults.readonly_only && (agent.permission.allow_write || agent.permission.allow_execute)) {
      throw ve(
        `${prefix}.permission`,
        "allow_write/allow_execute requires defaults.readonly_only=false（需同时关闭 defaults.readonly_only）",
      );
    }
  }
}

function validateCommand(command: string, p: string): void {
  const value = command.trim();
  if (!value) throw ve(p, "is required");
  if (/[;|&`$<>()\n\r]/.test(value)) {
    throw ve(p, "must not contain shell metacharacters; llmwiki starts the process without a shell");
  }
  if (/[/\\]/.test(value) && !path.isAbsolute(value)) {
    throw ve(p, "must be an executable name or an absolute path");
  }
}

function validateTimeout(value: number, min: number, max: number, p: string): void {
  if (value !== 0 && (value < min || value > max)) {
    throw ve(p, `must be between ${min} and ${max}`);
  }
}

function validateArgsNoCredentials(id: string, args: string[]): void {
  const credentialParams = new Set([
    "--token",
    "--api-key",
    "--api_key",
    "--password",
    "--secret",
    "--authorization",
    "--header",
  ]);
  let previousCredentialParam = false;
  let previousCredentialIndex = -1;
  args.forEach((arg, index) => {
    const p = `agents.${id}.args[${index}]`;
    const lower = arg.toLowerCase();
    if (previousCredentialParam) {
      throw ve(
        p,
        "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境",
      );
    }
    for (const param of credentialParams) {
      if (lower === param) {
        previousCredentialParam = true;
        previousCredentialIndex = index;
        break;
      }
      if (lower.startsWith(`${param}=`)) {
        throw ve(
          p,
          "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境",
        );
      }
    }
    if (hasCredentialValueShape(arg)) {
      throw ve(
        p,
        "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境",
      );
    }
  });
  if (previousCredentialParam) {
    throw ve(
      `agents.${id}.args[${previousCredentialIndex}]`,
      "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境",
    );
  }
}

function hasCredentialValueShape(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.startsWith("bearer ") || lower.startsWith("authorization:")) return true;
  for (const prefix of ["sk-", "ghp_", "github_pat_", "xoxb-", "xoxp-", "AKIA"]) {
    if (value.startsWith(prefix)) return true;
  }
  return value.startsWith("eyJ") && (value.match(/\./g)?.length ?? 0) >= 2;
}

export function applyDefaultsAfterParse(cfg: AcpConfig): void {
  if (!cfg) return;
  cfg.agents ??= {};
  if (!cfg.defaults.on_unavailable) cfg.defaults.on_unavailable = DEFAULT_ON_UNAVAILABLE;
  for (const [id, agent] of Object.entries(cfg.agents)) {
    agent.cwd_policy ||= DEFAULT_CWD_POLICY;
    agent.init_timeout_ms ||= DEFAULT_INIT_TIMEOUT_MS;
    agent.prompt_timeout_ms ||= DEFAULT_PROMPT_TIMEOUT_MS;
    agent.idle_timeout_ms ||= DEFAULT_IDLE_TIMEOUT_MS;
    agent.env_passthrough ??= ["PATH", "HOME", "LANG"];
    agent.permission.mode ||= "auto";
    cfg.agents[id] = agent;
  }
}

export function canonicalJson(cfg: AcpConfig): string {
  const value = cfg ?? defaultConfig();
  applyDefaultsAfterParse(value);
  return JSON.stringify(normalizeConfig(value), null, 2);
}

function normalizeConfig(cfg: AcpConfig): AcpConfig {
  const agents: Record<string, AgentConfig> = {};
  for (const id of Object.keys(cfg.agents).sort()) {
    const agent = cfg.agents[id]!;
    agents[id] = {
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled,
      command: agent.command,
      ...((agent.args ?? []).length > 0 ? { args: agent.args } : {}),
      env_passthrough: agent.env_passthrough ?? [],
      cwd_policy: agent.cwd_policy,
      init_timeout_ms: agent.init_timeout_ms,
      prompt_timeout_ms: agent.prompt_timeout_ms,
      idle_timeout_ms: agent.idle_timeout_ms,
      permission: {
        mode: agent.permission.mode,
        allow_read: agent.permission.allow_read,
        allow_search: agent.permission.allow_search,
        allow_fetch: agent.permission.allow_fetch,
        allow_write: agent.permission.allow_write,
        allow_execute: agent.permission.allow_execute,
      },
    };
  }
  return {
    version: cfg.version,
    agents,
    defaults: {
      readonly_only: cfg.defaults.readonly_only,
      on_unavailable: cfg.defaults.on_unavailable,
    },
  };
}

export function getAgent(cfg: AcpConfig | null | undefined, id: string): AgentConfig | undefined {
  return cfg?.agents[id];
}

export function hasEnabledAgent(cfg: AcpConfig | null | undefined): boolean {
  if (!cfg) return false;
  return Object.values(cfg.agents).some((agent) => agent.enabled);
}

export interface EnvVarStatus {
  name: string;
  present: boolean;
}

export interface RedactedAgent extends Omit<AgentConfig, "env_passthrough"> {
  env_passthrough: EnvVarStatus[];
}

export function redactedAgents(cfg: AcpConfig | null | undefined): RedactedAgent[] {
  if (!cfg) return [];
  return Object.values(cfg.agents)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled,
      command: agent.command,
      args: [...(agent.args ?? [])],
      env_passthrough: (agent.env_passthrough ?? []).map((name) => ({
        name,
        present: process.env[name] !== undefined,
      })),
      cwd_policy: agent.cwd_policy,
      init_timeout_ms: agent.init_timeout_ms,
      prompt_timeout_ms: agent.prompt_timeout_ms,
      idle_timeout_ms: agent.idle_timeout_ms,
      permission: { ...agent.permission },
    }));
}

export function applyAgentDefaults(agent: AgentConfig): AgentConfig {
  agent.cwd_policy ||= DEFAULT_CWD_POLICY;
  agent.init_timeout_ms ||= DEFAULT_INIT_TIMEOUT_MS;
  agent.prompt_timeout_ms ||= DEFAULT_PROMPT_TIMEOUT_MS;
  agent.idle_timeout_ms ||= DEFAULT_IDLE_TIMEOUT_MS;
  agent.env_passthrough ??= ["PATH", "HOME", "LANG"];
  return agent;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
