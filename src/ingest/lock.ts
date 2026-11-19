import { logger } from "../logger.js";

const LOCK_THRESHOLD_MS = 5000;

export interface LockStats {
  path: string;
  waitMs: number;
  holdMs: number;
}

interface PageLock {
  locked: boolean;
  refCount: number;
  lockTime: number;
  waiters: Array<() => void>;
}

export class PageLockManager {
  private readonly locks = new Map<string, PageLock>();
  private readonly stats: LockStats[] = [];

  async lock(path: string): Promise<() => void> {
    const normalized = normalizePath(path);
    const waitStart = Date.now();
    let entry = this.locks.get(normalized);
    if (!entry) {
      entry = { locked: false, refCount: 0, lockTime: 0, waiters: [] };
      this.locks.set(normalized, entry);
    }
    entry.refCount += 1;

    if (entry.locked) {
      await new Promise<void>((resolve) => entry!.waiters.push(resolve));
    }
    entry.locked = true;
    entry.lockTime = Date.now();
    const waitMs = Date.now() - waitStart;
    if (waitMs > LOCK_THRESHOLD_MS) {
      logger.warn({ path: normalized, waitMs }, "page lock wait exceeded threshold");
    }
    this.pushStats({ path: normalized, waitMs, holdMs: 0 });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const holdMs = Date.now() - entry!.lockTime;
      if (holdMs > LOCK_THRESHOLD_MS) {
        logger.warn({ path: normalized, holdMs }, "page lock hold exceeded threshold");
      }
      this.pushStats({ path: normalized, waitMs: 0, holdMs });
      entry!.refCount -= 1;
      const next = entry!.waiters.shift();
      if (next) {
        next();
        return;
      }
      entry!.locked = false;
      if (entry!.refCount <= 0) this.locks.delete(normalized);
    };
  }

  activeLocks(): string[] {
    return [...this.locks.keys()];
  }

  statsSnapshot(): LockStats[] {
    return [...this.stats];
  }

  private pushStats(item: LockStats): void {
    this.stats.push(item);
    if (this.stats.length > 256) this.stats.shift();
  }
}

function normalizePath(value: string): string {
  return value.toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
}

export { normalizePath };
