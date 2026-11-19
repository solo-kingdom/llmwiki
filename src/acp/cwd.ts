import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveCwd(workspace: string, sessionId: string, policy: string): Promise<string> {
  if (!workspace.trim()) throw new Error("workspace is required");
  const workspaceAbs = path.resolve(workspace);
  if (policy === "workspace") {
    await assertWithinWorkspace(workspaceAbs, workspaceAbs);
    return workspaceAbs;
  }
  if (policy === "session") {
    if (!sessionId || sessionId === "." || sessionId === ".." || /[/\\]/.test(sessionId)) {
      throw new Error("invalid session id for ACP cwd");
    }
    const dir = path.join(workspaceAbs, ".llmwiki", "cache", "acp", "sessions", sessionId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await assertWithinWorkspace(workspaceAbs, dir);
    return dir;
  }
  throw new Error(`unknown ACP cwd_policy ${JSON.stringify(policy)}`);
}

async function assertWithinWorkspace(workspace: string, target: string): Promise<void> {
  const workspaceAbs = path.resolve(workspace);
  const targetAbs = path.resolve(target);
  const workspaceReal = await realpath(workspaceAbs);
  const targetReal = await realpath(targetAbs);
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${path.sep}`)) {
    throw new Error(
      `ACP working directory ${JSON.stringify(targetReal)} is outside workspace ${JSON.stringify(workspaceReal)}`,
    );
  }
}
