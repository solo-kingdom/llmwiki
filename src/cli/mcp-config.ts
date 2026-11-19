import { isLoopback, resolveWorkspaceDir } from "./workspace.js";

export function runMcpConfig(
  dir: string | undefined,
  bind: string,
  port: number,
  token: string,
): void {
  const workspace = resolveWorkspaceDir(dir);
  const endpoint = `http://${bind}:${port}/mcp`;

  if (!isLoopback(bind) && !token) {
    throw new Error(
      `remote MCP config requires --token: bind address "${bind}" is not loopback.\n` +
        "Set --token <secret> matching your serve --token",
    );
  }

  const serverConfig: Record<string, unknown> = {
    url: endpoint,
    transport: "http-post-jsonrpc",
  };
  if (token) {
    serverConfig.headers = { Authorization: `Bearer ${token}` };
  }

  const config = {
    mcpServers: { llmwiki: serverConfig },
    workspace,
    endpoint,
    defaultToolPolicy: "readonly",
    transport: "http-post-jsonrpc",
  };
  console.log(JSON.stringify(config, null, 2));
}
