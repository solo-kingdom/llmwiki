import { isWriteToolName, DEFAULT_TOOL_READ, DEFAULT_TOOL_SEARCH, type McpConfig, type ServerConfig } from "./config.js";
import type { Tool } from "./types.js";

export function filterTools(tools: Tool[], cfg: McpConfig | null, server: ServerConfig | null): Tool[] {
  if (!cfg || !server) return [];
  const allowed = allowedSet(server, cfg.defaults.readonly_only);
  if (allowed.size === 0) return [];
  return tools.filter((tool) => allowed.has(tool.name.toLowerCase()));
}

export function allowedSet(server: ServerConfig, readonlyOnly: boolean): Set<string> {
  const tools =
    server.allowed_tools && server.allowed_tools.length > 0
      ? server.allowed_tools
      : readonlyOnly
        ? [DEFAULT_TOOL_SEARCH, DEFAULT_TOOL_READ]
        : [];
  const set = new Set<string>();
  for (const tool of tools) {
    const name = tool.trim().toLowerCase();
    if (!name) continue;
    if (readonlyOnly && isWriteToolName(name) && !server.allow_write_tools) continue;
    set.add(name);
  }
  return set;
}

export function isToolCallAllowed(
  cfg: McpConfig | null,
  server: ServerConfig | null,
  toolName: string,
): boolean {
  if (!cfg || !server) return false;
  return allowedSet(server, cfg.defaults.readonly_only).has(toolName.trim().toLowerCase());
}

export interface ToolPolicy {
  allowWriteTools: boolean;
  readonlyTools: Set<string>;
  writeTools: Set<string>;
}

export function defaultToolPolicy(allowWrite: boolean): ToolPolicy {
  return {
    allowWriteTools: allowWrite,
    readonlyTools: new Set([
      "guide",
      "search",
      "read",
      "references",
      "lint",
      "ping",
      "archive_list",
      "archive_read",
    ]),
    writeTools: new Set([
      "write",
      "delete",
      "archive",
      "reopen",
      "archive_mkdir",
      "archive_upload",
      "archive_move",
      "archive_delete",
      "archive_link",
      "archive_ingest",
    ]),
  };
}

export function toolPolicyAllows(policy: ToolPolicy, name: string): boolean {
  if (policy.readonlyTools.has(name)) return true;
  if (policy.writeTools.has(name)) return policy.allowWriteTools;
  return true;
}

export function toolPolicyFilter(policy: ToolPolicy, tools: Tool[]): Tool[] {
  return tools.filter((tool) => toolPolicyAllows(policy, tool.name));
}
