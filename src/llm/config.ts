import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "./client.js";
import type { LLMConfig, WorkspaceConfig } from "./types.js";

export function defaultWorkspaceConfig(): WorkspaceConfig {
  return {
    provider: "openai",
    api_key: "",
    model: "gpt-4o",
    base_url: "",
    request_timeout: 1800,
    stream_idle_timeout: 120,
  };
}

export async function loadConfig(workspaceDir: string): Promise<WorkspaceConfig> {
  const config = defaultWorkspaceConfig();
  const filePath = path.join(workspaceDir, ".llmwiki", "config.json");
  try {
    const raw = await readFile(filePath, "utf8");
    Object.assign(config, JSON.parse(raw) as Partial<WorkspaceConfig>);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if (!config.provider) config.provider = envOr("LLMWIKI_PROVIDER", config.provider);
  if (!config.api_key) {
    config.api_key = envOr(
      "LLMWIKI_API_KEY",
      envOr("OPENAI_API_KEY", envOr("ANTHROPIC_API_KEY", config.api_key)),
    );
  }
  if (!config.model) config.model = envOr("LLMWIKI_MODEL", config.model);
  if (!config.base_url) config.base_url = envOr("LLMWIKI_BASE_URL", config.base_url);
  return config;
}

export async function saveConfig(workspaceDir: string, config: WorkspaceConfig): Promise<void> {
  const dir = path.join(workspaceDir, ".llmwiki");
  await mkdir(dir, { recursive: true, mode: 0o755 });
  await writeFile(path.join(dir, "config.json"), JSON.stringify(config, null, 2), { mode: 0o644 });
}

export class ConfigManager {
  private config: WorkspaceConfig;
  private readonly workspaceDir: string;
  private client: Client;

  private constructor(workspaceDir: string, config: WorkspaceConfig) {
    this.workspaceDir = workspaceDir;
    this.config = config;
    this.client = new Client(toClientConfig(config));
  }

  static async create(workspaceDir: string): Promise<ConfigManager> {
    const config = await loadConfig(workspaceDir);
    return new ConfigManager(workspaceDir, config);
  }

  async reloadConfig(): Promise<void> {
    const config = await loadConfig(this.workspaceDir);
    this.config = config;
    this.client = new Client(toClientConfig(config));
  }

  getClient(): Client {
    return this.client;
  }

  getConfig(): WorkspaceConfig {
    return this.config;
  }

  async updateConfig(config: WorkspaceConfig): Promise<void> {
    await saveConfig(this.workspaceDir, config);
    await this.reloadConfig();
  }
}

export function toClientConfig(config: WorkspaceConfig): LLMConfig {
  const timeoutMs =
    config.request_timeout > 0 ? config.request_timeout * 1000 : DEFAULT_TIMEOUT_MS;
  const streamIdleTimeoutMs =
    config.stream_idle_timeout > 0
      ? config.stream_idle_timeout * 1000
      : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  return {
    provider: config.provider,
    baseUrl: config.base_url,
    apiKey: config.api_key,
    model: config.model,
    timeoutMs,
    streamIdleTimeoutMs,
  };
}

function envOr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
