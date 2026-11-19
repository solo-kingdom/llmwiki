import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "./config.js";
import { cliNotFound } from "./errors.js";
import { LinuxProcessCleanup, signalProcessGroupLinux } from "./process_group_linux.js";
import { UnixProcessCleanup, signalProcessGroupUnix } from "./process_group_unix.js";
import { WindowsProcessCleanup, signalProcessGroupWindows } from "./process_group_windows.js";
import { sanitizeText } from "./sanitize.js";
import { SIGNAL_KILL, SIGNAL_TERM, type ProcessSignal } from "./process_signals.js";

const STDERR_TAIL_LIMIT = 4 * 1024;
const TERMINATE_GRACE_MS = 3000;

interface Cleanup {
  watch(): void;
  signal(rootPid: number, signal: ProcessSignal): Promise<void>;
  wait(timeoutMs: number): void | Promise<void>;
  cleanup(): void;
  err(): unknown;
}

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class AgentProcess {
  readonly pid: number;
  private readonly child: ChildProcess;
  private readonly cleanup: Cleanup;
  private readonly done: Promise<ProcessExit>;
  private stderrData = "";
  private terminated = false;
  private terminateError: unknown;

  constructor(child: ChildProcess, cleanup: Cleanup) {
    this.child = child;
    this.pid = child.pid ?? -1;
    this.cleanup = cleanup;
    this.done = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", () => resolve({ code: null, signal: null }));
    });
    child.on("error", () => {});
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrData += chunk;
      if (this.stderrData.length > STDERR_TAIL_LIMIT) {
        this.stderrData = this.stderrData.slice(-STDERR_TAIL_LIMIT);
      }
    });
  }

  get stdin() {
    return this.child.stdin;
  }

  get stdout() {
    return this.child.stdout;
  }

  get waitDone(): Promise<ProcessExit> {
    return this.done;
  }

  stderrTail(): string {
    return sanitizeText(this.stderrData);
  }

  async write(data: string): Promise<void> {
    if (!this.child.stdin || this.child.stdin.destroyed) {
      throw new Error("ACP process stdin is unavailable");
    }
    await new Promise<void>((resolve, reject) => {
      this.child.stdin!.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  closeStdin(): void {
    if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
  }

  async terminate(): Promise<void> {
    if (this.terminated) {
      if (this.terminateError) throw this.terminateError;
      return;
    }
    this.terminated = true;
    try {
      await this.performTerminate();
    } catch (error) {
      this.terminateError = error;
      throw error;
    }
  }

  private async performTerminate(): Promise<void> {
    if (!this.child.pid) return;
    this.cleanup.watch();
    const first = await this.signalTargets(SIGNAL_TERM);
    const groupErr = await this.signalGroup(SIGNAL_TERM);

    await Promise.race([this.done, delay(TERMINATE_GRACE_MS)]);

    const second = await this.signalTargets(SIGNAL_KILL);
    const groupErr2 = await this.signalGroup(SIGNAL_KILL);

    this.closeStdin();
    await this.done;

    await this.cleanup.wait(2000);
    this.cleanup.cleanup();

    const cleanupErr = this.cleanup.err();
    const error = firstError(first, second, groupErr, groupErr2, cleanupErr);
    if (error) throw error;
  }

  private async signalTargets(signal: ProcessSignal): Promise<unknown> {
    try {
      await this.cleanup.signal(this.pid, signal);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private async signalGroup(signal: ProcessSignal): Promise<unknown> {
    try {
      if (process.platform === "linux") {
        await signalProcessGroupLinux(this.pid, signal);
      } else if (process.platform === "win32") {
        await signalProcessGroupWindows(this.pid, signal);
      } else {
        await signalProcessGroupUnix(this.pid, signal);
      }
      return undefined;
    } catch (error) {
      return isMissingProcess(error) ? undefined : error;
    }
  }
}

export async function spawnAgent(
  cfg: AgentConfig,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentProcess> {
  if (signal?.aborted) throw abortError(signal);

  const executable = await lookPath(cfg.command);
  if (!executable) throw cliNotFound(cfg.command, "not found in PATH");

  const child = spawnChild(executable, cfg.args ?? [], {
    cwd,
    env: whitelistedEnv(cfg.env_passthrough ?? []),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(new Error(`start ACP agent: ${error.message}`));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });

  const cleanup: Cleanup =
    process.platform === "linux"
      ? new LinuxProcessCleanup()
      : process.platform === "win32"
        ? new WindowsProcessCleanup()
        : new UnixProcessCleanup();

  return new AgentProcess(child, cleanup);
}

export async function lookPath(command: string): Promise<string | null> {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) {
    return (await isExecutable(command)) ? command : null;
  }
  const pathValue = process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathValue.split(separator)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function whitelistedEnv(names: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of names) {
    if (name in env) continue;
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function firstError(...errors: unknown[]): unknown {
  return errors.find((error) => error !== undefined && error !== null);
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ESRCH"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}
