import { readFile } from "node:fs/promises";
import type { ProcessSignal } from "./process_signals.js";

interface Pin {
  pid: number;
  startTime: number;
}

export class LinuxProcessCleanup {
  private readonly pins = new Map<number, Pin>();
  private readonly errors: unknown[] = [];

  watch(): void {
    // Snapshots are taken synchronously in signal(); there is no background watcher.
  }

  async signal(rootPid: number, signal: ProcessSignal): Promise<void> {
    await this.walk(rootPid);
    await this.signalPinned(signal);
  }

  wait(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = async () => {
        const live: number[] = [];
        for (const pin of this.pins.values()) {
          if (await isSameProcess(pin)) live.push(pin.pid);
        }
        if (live.length === 0 || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(poll, 50);
      };
      void poll();
    });
  }

  cleanup(): void {
    this.pins.clear();
  }

  err(): unknown {
    return this.errors[0];
  }

  private async signalPinned(signal: ProcessSignal): Promise<void> {
    for (const pin of this.pins.values()) {
      if (!(await isSameProcess(pin))) {
        this.pins.delete(pin.pid);
        continue;
      }
      try {
        process.kill(pin.pid, signal);
      } catch (error) {
        if (!isMissingProcess(error)) this.errors.push(error);
      }
    }
  }

  private async walk(rootPid: number): Promise<void> {
    if ((await procStartTime(rootPid)) === null) return;
    const seen = new Set<number>([rootPid]);
    const queue = [rootPid];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of await procChildren(current)) {
        if (seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
        const startTime = await procStartTime(child);
        if (startTime !== null) this.pins.set(child, { pid: child, startTime });
      }
    }
  }
}

async function isSameProcess(pin: Pin): Promise<boolean> {
  const current = await procStartTime(pin.pid);
  return current !== null && current === pin.startTime;
}

export async function signalProcessGroupLinux(pid: number, signal: ProcessSignal): Promise<void> {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

async function procStartTime(pid: number): Promise<number | null> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close < 0) return null;
    const fields = raw.slice(close + 1).trim().split(/\s+/);
    const value = fields[19];
    if (value === undefined) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function procChildren(pid: number): Promise<number[]> {
  try {
    const raw = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    return raw
      .trim()
      .split(/\s+/)
      .map((field) => Number.parseInt(field, 10))
      .filter((child) => Number.isFinite(child) && child > 0);
  } catch {
    return [];
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
