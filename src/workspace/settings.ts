import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../store/interfaces.js";
import { logger } from "../logger.js";
import { CONFIG_HARNIX_SETTINGS } from "../harness/settings.js";
import {
  CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA,
} from "../mcp/tool_loop_settings.js";

const SETTINGS_EXPORT_REL_PATH = ".llmwiki/workspace-settings.json";

const EXPORT_KEYS = [
  "last_instance_id",
  "last_model",
  "job_instance_id",
  "job_model",
  "job_parallel_enabled",
  "job_max_concurrent",
  "temperature",
  "max_tokens",
  "chunk_size",
  "chunk_overlap",
  "auto_reindex",
  "watch_sources",
  "activity_logs_max_count",
  "ingest_job_events_max_count",
  "session_message_events_max_count",
  "mcp_servers_json",
  "ui_language",
  "doc_language",
  "rules_supplement",
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_INGEST,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_QA,
  CONFIG_SESSION_TOOL_LOOP_MAX_ROUNDS_ORGANIZE,
  CONFIG_SESSION_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  CONFIG_HARNIX_SETTINGS,
];

interface SettingsFile {
  version: number;
  values: Record<string, string>;
}

export async function exportSettings(db: Store | null, workspace: string): Promise<void> {
  if (!db || !workspace) return;
  const values: Record<string, string> = {};
  for (const key of EXPORT_KEYS) {
    const value = await db.getConfig(key);
    if (value) values[key] = value;
  }
  const payload: SettingsFile = { version: 1, values };
  const target = path.join(workspace, SETTINGS_EXPORT_REL_PATH);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 });
}

export async function importSettingsIfEmpty(db: Store | null, workspace: string): Promise<void> {
  if (!db || !workspace) return;
  const last = await db.getConfig("last_instance_id");
  const temperature = await db.getConfig("temperature");
  if (last.trim() || temperature.trim()) return;
  await importSettings(db, workspace);
}

export async function importSettings(db: Store | null, workspace: string): Promise<void> {
  if (!db || !workspace) return;
  const target = path.join(workspace, SETTINGS_EXPORT_REL_PATH);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  let file: SettingsFile;
  try {
    file = JSON.parse(raw) as SettingsFile;
  } catch (error) {
    logger.warn({ error }, "[workspace] skip settings import: invalid JSON");
    return;
  }
  if (file.version !== 1) {
    logger.warn({ version: file.version }, "[workspace] skip settings import: unsupported version");
    return;
  }
  for (const [key, value] of Object.entries(file.values ?? {})) {
    if (!EXPORT_KEYS.includes(key)) continue;
    await db.setConfig(key, value);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
