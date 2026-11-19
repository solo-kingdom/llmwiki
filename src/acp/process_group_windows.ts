import { spawnSync } from "node:child_process";
import type { ProcessSignal } from "./process_signals.js";
import { SIGNAL_KILL } from "./process_signals.js";

export class WindowsProcessCleanup {
  watch(): void {}
  async signal(_rootPid: number, _signal: ProcessSignal): Promise<void> {}
  wait(_timeoutMs: number): void {}
  cleanup(): void {}
  err(): unknown {
    return undefined;
  }
}

export async function signalProcessGroupWindows(pid: number, signal: ProcessSignal): Promise<void> {
  if (signal !== SIGNAL_KILL || pid <= 0) return;
  try {
    process.kill(pid);
  } catch {
    // Windows has no SIGTERM; defer to taskkill for the hard-kill phase below.
  }
  spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}
