import type { ProcessSignal } from "./process_signals.js";

export class UnixProcessCleanup {
  watch(): void {}
  async signal(_rootPid: number, _signal: ProcessSignal): Promise<void> {}
  wait(_timeoutMs: number): void {}
  cleanup(): void {}
  err(): unknown {
    return undefined;
  }
}

export async function signalProcessGroupUnix(pid: number, signal: ProcessSignal): Promise<void> {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ESRCH"
  );
}
