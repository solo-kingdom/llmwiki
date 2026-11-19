import type { ToolLoopConfig } from "../llm/types.js";
import { toolLoopConfigForMode } from "./local_tools.js";

export const CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST = "session_tool_loop_max_rounds_ingest";
export const CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA = "session_tool_loop_max_rounds_qa";
export const CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE = "session_tool_loop_max_rounds_organize";
export const CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND = "session_tool_loop_max_calls_per_round";

export const MIN_TOOL_LOOP_MAX_ROUNDS = 1;
export const MAX_TOOL_LOOP_MAX_ROUNDS = 32;
export const MIN_TOOL_LOOP_MAX_CALLS_PER_ROUND = 1;
export const MAX_TOOL_LOOP_MAX_CALLS_PER_ROUND = 16;

export interface ConfigReader {
  getConfig(key: string): Promise<string>;
}

export function sessionToolLoopMaxRoundsConfigKey(mode: string): string {
  switch (mode) {
    case "qa":
      return CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA;
    case "organize":
      return CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE;
    default:
      return CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST;
  }
}

export function parseToolLoopMaxRounds(raw: string): number {
  const value = raw.trim();
  if (!value) throw new Error("session tool loop max rounds must not be empty");
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid session tool loop max rounds: ${JSON.stringify(raw)}`);
  }
  if (parsed < MIN_TOOL_LOOP_MAX_ROUNDS || parsed > MAX_TOOL_LOOP_MAX_ROUNDS) {
    throw new Error(
      `session tool loop max rounds must be between ${MIN_TOOL_LOOP_MAX_ROUNDS} and ${MAX_TOOL_LOOP_MAX_ROUNDS}`,
    );
  }
  return parsed;
}

export function parseToolLoopMaxCallsPerRound(raw: string): number {
  const value = raw.trim();
  if (!value) throw new Error("session tool loop max calls per round must not be empty");
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid session tool loop max calls per round: ${JSON.stringify(raw)}`);
  }
  if (
    parsed < MIN_TOOL_LOOP_MAX_CALLS_PER_ROUND ||
    parsed > MAX_TOOL_LOOP_MAX_CALLS_PER_ROUND
  ) {
    throw new Error(
      `session tool loop max calls per round must be between ${MIN_TOOL_LOOP_MAX_CALLS_PER_ROUND} and ${MAX_TOOL_LOOP_MAX_CALLS_PER_ROUND}`,
    );
  }
  return parsed;
}

export function sessionToolLoopMaxRoundsForResponse(stored: string, mode: string): string {
  if (stored.trim()) return stored;
  return String(toolLoopConfigForMode(mode).maxRounds);
}

export function sessionToolLoopMaxCallsForResponse(stored: string): string {
  if (stored.trim()) return stored;
  return String(toolLoopConfigForMode("").maxToolCallsPerRound);
}

export async function toolLoopConfigForModeFromStore(
  mode: string,
  store: ConfigReader | null,
): Promise<ToolLoopConfig> {
  const cfg = toolLoopConfigForMode(mode);
  if (!store) return cfg;

  try {
    const raw = await store.getConfig(sessionToolLoopMaxRoundsConfigKey(mode));
    if (raw.trim()) {
      try {
        cfg.maxRounds = parseToolLoopMaxRounds(raw);
      } catch {
        // Invalid stored values fall back to mode defaults.
      }
    }
  } catch {
    // Missing config leaves the default.
  }
  try {
    const raw = await store.getConfig(CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND);
    if (raw.trim()) {
      try {
        cfg.maxToolCallsPerRound = parseToolLoopMaxCallsPerRound(raw);
      } catch {
        // Invalid stored values fall back to mode defaults.
      }
    }
  } catch {
    // Missing config leaves the default.
  }
  return cfg;
}
