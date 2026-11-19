import { defaultConfig, parseConfig, type McpConfig, type ServerConfig } from "./config.js";

export class McpRegistry {
  private cfg: McpConfig;
  private raw: string;

  constructor(raw: string) {
    this.cfg = parseConfig(raw);
    this.raw = raw;
  }

  config(): McpConfig {
    return this.cfg;
  }

  jobServers(): ServerConfig[] {
    return Object.values(this.cfg.servers).filter(
      (server) => server.enabled && !(server.scope.chat && !server.scope.job),
    );
  }

  chatServers(): ServerConfig[] {
    return Object.values(this.cfg.servers).filter((server) => server.enabled && server.scope.chat);
  }

  reload(raw: string): void {
    this.cfg = parseConfig(raw);
    this.raw = raw;
  }

  rawConfig(): string {
    return this.raw;
  }
}

export function emptyRegistry(): McpRegistry {
  return new McpRegistry(JSON.stringify(defaultConfig()));
}
