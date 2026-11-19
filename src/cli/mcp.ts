import { runLocalMcp } from "../mcp/tools.js";
import { openCliStore, resolveWorkspaceDir } from "./workspace.js";

export async function runMcp(dir: string | undefined, databaseUrl?: string): Promise<void> {
  const workspace = resolveWorkspaceDir(dir);
  const store = await openCliStore(databaseUrl);
  try {
    console.error(`LLM Wiki MCP (stdio) — workspace: ${workspace}`);
    await runLocalMcp(workspace, store);
  } finally {
    await store.close();
  }
}
