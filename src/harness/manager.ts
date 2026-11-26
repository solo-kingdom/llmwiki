import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AcpHarness, type AcpAgentEntry, type HarnixSettings } from "harnix";

export async function resolveCwd(
  workspace: string,
  sessionId: string,
  policy: "workspace" | "session",
): Promise<string> {
  if (!workspace.trim()) {
    throw new Error("workspace is not configured");
  }
  const root = path.resolve(workspace);
  if (policy === "session") {
    if (!sessionId.trim()) {
      throw new Error("session id is required for session cwd policy");
    }
    const dir = path.join(root, ".llmwiki", "sessions", sessionId.trim());
    await mkdir(dir, { recursive: true, mode: 0o755 });
    return dir;
  }
  return root;
}

interface CachedAcpHarness {
  readonly fingerprint: string;
  readonly harness: AcpHarness;
}

function buildFingerprint(entry: AcpAgentEntry, maxConcurrentSessions: number): string {
  return JSON.stringify({
    maxConcurrentSessions,
    command: entry.command,
    args: entry.args,
    envPassthrough: entry.envPassthrough,
    initTimeoutMs: entry.initTimeoutMs,
    promptTimeoutMs: entry.promptTimeoutMs,
    idleTimeoutMs: entry.idleTimeoutMs,
  });
}

export class HarnessManager {
  private readonly acpPool = new Map<string, CachedAcpHarness>();

  hasCapacity(sessionId: string, agentId: string, settings: HarnixSettings): boolean {
    const cached = this.acpPool.get(agentId);
    if (cached) {
      return cached.harness.hasSessionCapacity(sessionId);
    }
    return settings.acp.maxConcurrentSessions > 0;
  }

  acquireAcpHarness(agentId: string, settings: HarnixSettings, defaultCwd: string): AcpHarness {
    const entry = settings.acp.agents[agentId];
    if (!entry) {
      throw new Error(`ACP agent "${agentId}" is not configured`);
    }
    const fingerprint = buildFingerprint(entry, settings.acp.maxConcurrentSessions);
    const existing = this.acpPool.get(agentId);
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        return existing.harness;
      }
      this.acpPool.delete(agentId);
      void existing.harness.close().catch(() => undefined);
    }

    const harness = new AcpHarness({
      maxConcurrentSessions: settings.acp.maxConcurrentSessions,
      agent: {
        command: entry.command,
        args: entry.args,
        envPassthrough: entry.envPassthrough,
        cwd: defaultCwd,
        initTimeoutMs: entry.initTimeoutMs,
        promptTimeoutMs: entry.promptTimeoutMs,
        idleTimeoutMs: entry.idleTimeoutMs,
        clientInfo: {
          name: "llmwiki",
          title: "LLM Wiki",
          version: "0.1.0",
        },
      },
    });
    this.acpPool.set(agentId, { fingerprint, harness });
    return harness;
  }

  async closeSession(sessionId: string): Promise<void> {
    await Promise.all(
      [...this.acpPool.values()].map((entry) => entry.harness.closeSession(sessionId).catch(() => undefined)),
    );
  }

  async closeAll(): Promise<void> {
    const entries = [...this.acpPool.values()];
    this.acpPool.clear();
    await Promise.all(entries.map((entry) => entry.harness.close().catch(() => undefined)));
  }
}
