import { logger } from "../logger.js";
import type { Store } from "../store/interfaces.js";
import type { ActivityLog, IngestJob } from "../store/types.js";

export interface Entry {
  level: string;
  category: string;
  action: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  status?: string;
  details?: Record<string, unknown> | null;
  source?: string;
}

const SECRET_KEYS = new Set(["api_key", "authorization", "x-api-key", "token", "secret", "password"]);

export function sanitizeDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!details) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

export function record(db: Store | null | undefined, entry: Entry): void {
  if (!db) return;
  void writeOne(db, entry);
}

export async function recordSync(db: Store | null | undefined, entry: Entry): Promise<void> {
  if (!db) return;
  await writeOne(db, entry);
}

async function writeOne(db: Store, entry: Entry): Promise<void> {
  const details = sanitizeDetails(entry.details);
  const detailsJson = details && Object.keys(details).length > 0 ? JSON.stringify(details) : "";
  const row: ActivityLog = {
    id: 0,
    created_at: "",
    level: entry.level,
    category: entry.category,
    action: entry.action,
    message: entry.message,
    resource_type: entry.resourceType ?? "",
    resource_id: entry.resourceId ?? "",
    status: entry.status ?? "",
    details: detailsJson,
    source: entry.source ?? "",
  };
  try {
    await db.createActivityLog(row);
  } catch (error) {
    logger.error({ error, category: entry.category, action: entry.action }, "activity write failed");
  }
}

export function logIngestJob(
  db: Store | null | undefined,
  job: IngestJob | null | undefined,
  action: string,
  source: string,
): void {
  if (!db || !job) return;
  const level = job.status === "failed" ? "error" : "info";
  const message = job.source_path
    ? `摄入任务 ${job.id}（${job.source_path}）：${action}`
    : `摄入任务 ${job.id}：${action}`;
  const details: Record<string, unknown> = {
    job_id: job.id,
    source_path: job.source_path,
    status: job.status,
    input_type: job.input_type,
  };
  if (job.error_message) details.error = job.error_message;
  if (job.error_code) details.error_code = job.error_code;
  record(db, {
    level,
    category: "ingest",
    action,
    message,
    resourceType: "ingest_job",
    resourceId: job.id,
    status: job.status,
    source,
    details,
  });
}

export function logSession(
  db: Store | null | undefined,
  action: string,
  sessionId: string,
  message: string,
  status: string,
  source: string,
  details?: Record<string, unknown>,
): void {
  if (!db) return;
  const level = status === "failure" || action === "stream_error" ? "error" : "info";
  record(db, {
    level,
    category: "session",
    action,
    message: message || `会话 ${sessionId}：${action}`,
    resourceType: "ingest_session",
    resourceId: sessionId,
    status,
    source,
    details: { session_id: sessionId, ...(details ?? {}) },
  });
}

export function logMcpTool(db: Store | null | undefined, toolName: string): void {
  if (!db || !toolName) return;
  record(db, {
    level: "info",
    category: "mcp",
    action: "tool_called",
    message: `MCP 工具调用：${toolName}`,
    resourceType: "mcp_tool",
    resourceId: toolName,
    status: "success",
    source: "mcp",
    details: { tool: toolName },
  });
}

export interface McpToolCallInfo {
  toolName: string;
  remoteAddr: string;
  clientAgent: string;
  durationMs: number;
  status: string;
  errorType: string;
}

export function logMcpRemoteToolCall(db: Store | null | undefined, info: McpToolCallInfo): void {
  if (!db) return;
  const level = info.status === "failure" || info.status === "denied" ? "warn" : "info";
  const details: Record<string, unknown> = {
    tool: info.toolName,
    remote_addr: sanitizeRemoteAddr(info.remoteAddr),
    duration_ms: info.durationMs,
  };
  if (info.clientAgent) details.client_agent = info.clientAgent;
  if (info.errorType) details.error_type = info.errorType;
  record(db, {
    level,
    category: "mcp",
    action: "remote_tool_called",
    message: `远程 MCP 工具调用：${info.toolName} (${info.status})`,
    resourceType: "mcp_tool",
    resourceId: info.toolName,
    status: info.status,
    source: "mcp-remote",
    details,
  });
}

export function logDocument(
  db: Store | null | undefined,
  action: string,
  documentId: string,
  relativePath: string,
  source: string,
): void {
  if (!db) return;
  record(db, {
    level: "info",
    category: "document",
    action,
    message: `文档 ${relativePath || documentId}：${action}`,
    resourceType: "document",
    resourceId: documentId,
    status: "success",
    source,
    details: { document_id: documentId, relative_path: relativePath },
  });
}

export function sanitizeRemoteAddr(addr: string): string {
  let value = addr;
  const index = value.lastIndexOf(":");
  if (index > 0) value = value.slice(0, index);
  const parts = value.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return value.length > 20 ? `${value.slice(0, 20)}...` : value;
}

export const DEFAULT_ACTIVITY_MAX_COUNT = 10000;
export const MIN_ACTIVITY_MAX_COUNT = 100;
export const MAX_ACTIVITY_MAX_COUNT = 100000;
