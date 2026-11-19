import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SessionStore } from "../interfaces.js";
import type {
  IngestSession,
  IngestSessionMessage,
  IngestSessionReference,
  SessionMessageEvent,
} from "../types.js";
import {
  DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT,
  MAX_SESSION_MSG_EVENTS_MAX_COUNT,
  MIN_SESSION_MSG_EVENTS_MAX_COUNT,
  SESSION_REF_SOURCE_TOOL_READ,
  SESSION_REF_SOURCE_USER_MENTION,
} from "../types.js";
import { NOW_TEXT, asBoolean, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const SESSION_COLUMNS = `
  COALESCE(id, ''), COALESCE(title, ''), COALESCE(status, ''),
  COALESCE(storage_path, ''), COALESCE(llm_instance_id, ''), COALESCE(llm_model, ''),
  COALESCE(mode, 'ingest'), COALESCE(agent_kind, 'native'), COALESCE(acp_agent_id, ''),
  COALESCE(created_at, ''), COALESCE(updated_at, '')`;

const MESSAGE_COLUMNS = `
  COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(role, ''),
  COALESCE(content, ''), COALESCE(message_type, ''), COALESCE(attachment_id, ''),
  COALESCE(stream_status, ''), COALESCE(wiki_refs_json, '[]'),
  COALESCE(exclude_from_archive, FALSE), COALESCE(created_at, '')`;

const REFERENCE_COLUMNS = `
  COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(document_id, ''),
  COALESCE(relative_path, ''), COALESCE(title, ''), COALESCE(source, ''),
  COALESCE(first_seen_at, '')`;

function scanSession(row: unknown[]): IngestSession {
  return {
    id: asString(row[0]),
    title: asString(row[1]),
    status: asString(row[2]),
    storage_path: asString(row[3]),
    llm_instance_id: asString(row[4]),
    llm_model: asString(row[5]),
    mode: asString(row[6]),
    agent_kind: asString(row[7]),
    acp_agent_id: asString(row[8]),
    created_at: asString(row[9]),
    updated_at: asString(row[10]),
  };
}

function scanMessage(row: unknown[]): IngestSessionMessage {
  return {
    id: asString(row[0]),
    session_id: asString(row[1]),
    role: asString(row[2]),
    content: asString(row[3]),
    message_type: asString(row[4]),
    attachment_id: asString(row[5]),
    stream_status: asString(row[6]),
    wiki_refs_json: asString(row[7]),
    exclude_from_archive: asBoolean(row[8]),
    created_at: asString(row[9]),
  };
}

function scanReference(row: unknown[]): IngestSessionReference {
  return {
    id: asString(row[0]),
    session_id: asString(row[1]),
    document_id: asString(row[2]),
    relative_path: asString(row[3]),
    title: asString(row[4]),
    source: asString(row[5]),
    first_seen_at: asString(row[6]),
  };
}

function normalizeWikiRefs(raw: string | undefined): string {
  return raw?.trim() ? raw : "[]";
}

function clampMsgEventsMaxCount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT;
  if (parsed < MIN_SESSION_MSG_EVENTS_MAX_COUNT) return MIN_SESSION_MSG_EVENTS_MAX_COUNT;
  if (parsed > MAX_SESSION_MSG_EVENTS_MAX_COUNT) return MAX_SESSION_MSG_EVENTS_MAX_COUNT;
  return parsed;
}

async function configValue(pool: Pool, key: string): Promise<string> {
  const row = await queryOne<[string]>(
    pool,
    "SELECT COALESCE(value, '') FROM app_config WHERE key = $1",
    [key],
  );
  return row ? asString(row[0]) : "";
}

export function ingestSessionsRepo(pool: Pool): SessionStore {
  async function trimMessageEvents(messageID: string, maxCount: number): Promise<void> {
    if (maxCount <= 0) return;
    await exec(
      pool,
      `DELETE FROM session_message_events
       WHERE message_id = $1
       AND id NOT IN (
         SELECT id FROM session_message_events
         WHERE message_id = $2
         ORDER BY id DESC
         LIMIT $3
       )`,
      [messageID, messageID, maxCount],
    );
  }

  return {
    async countIngestSessions(): Promise<number> {
      const row = await queryOne<[number]>(pool, "SELECT COUNT(*) FROM ingest_sessions");
      return row ? asNumber(row[0]) : 0;
    },

    async createIngestSession(session: IngestSession): Promise<void> {
      if (!session) throw new Error("nil ingest session");
      if (!session.status) session.status = "active";
      if (!session.mode) session.mode = "ingest";
      if (!session.agent_kind) session.agent_kind = "native";
      const row = await queryOne(
        pool,
        `INSERT INTO ingest_sessions (
          id, title, status, storage_path, llm_instance_id, llm_model,
          mode, agent_kind, acp_agent_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${NOW_TEXT}, ${NOW_TEXT})
        RETURNING ${SESSION_COLUMNS}`,
        [
          randomUUID(),
          session.title.trim(),
          session.status,
          session.storage_path.trim(),
          session.llm_instance_id,
          session.llm_model,
          session.mode,
          session.agent_kind,
          session.acp_agent_id.trim(),
        ],
      );
      if (!row) throw new Error("create ingest session: no row returned");
      Object.assign(session, scanSession(row));
    },

    async getIngestSession(id: string): Promise<IngestSession | null> {
      const row = await queryOne(
        pool,
        `SELECT ${SESSION_COLUMNS} FROM ingest_sessions WHERE id = $1`,
        [id],
      );
      return row ? scanSession(row) : null;
    },

    async listIngestSessions(): Promise<IngestSession[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${SESSION_COLUMNS} FROM ingest_sessions ORDER BY updated_at DESC, id DESC`,
      );
      return rows.map(scanSession);
    },

    async updateIngestSessionStoragePath(id: string, storagePath: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions SET storage_path = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [storagePath, id],
      );
    },

    async updateIngestSessionTitle(id: string, title: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions SET title = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [title.trim(), id],
      );
    },

    async updateIngestSessionStatus(id: string, status: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions SET status = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [status, id],
      );
    },

    async updateIngestSessionMode(id: string, mode: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions SET mode = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [mode, id],
      );
    },

    async updateIngestSessionAgent(id: string, agentKind: string, acpAgentID: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions
         SET agent_kind = $1, acp_agent_id = $2, updated_at = ${NOW_TEXT}
         WHERE id = $3`,
        [agentKind, acpAgentID, id],
      );
    },

    async updateIngestSessionLLM(id: string, instanceID: string, model: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_sessions SET llm_instance_id = $1, llm_model = $2, updated_at = ${NOW_TEXT}
         WHERE id = $3`,
        [instanceID, model, id],
      );
    },

    async updateIngestSessionStatusAndTitle(id: string, status: string, title: string): Promise<void> {
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE ingest_sessions SET status=$2, updated_at=(${NOW_TEXT}) WHERE id=$1`,
          [id, status],
        );
        if (title) {
          await client.query(
            `UPDATE ingest_sessions SET title=$2, updated_at=(${NOW_TEXT}) WHERE id=$1`,
            [id, title],
          );
        }
      });
    },

    async deleteIngestSession(id: string): Promise<void> {
      const affected = await exec(pool, "DELETE FROM ingest_sessions WHERE id = $1", [id]);
      if (affected === 0) throw new Error("session not found");
    },

    async createIngestSessionMessage(msg: IngestSessionMessage): Promise<void> {
      if (!msg) throw new Error("nil message");
      if (!msg.role) throw new Error("role is required");
      if (!msg.message_type) msg.message_type = "text";
      if (!msg.stream_status) msg.stream_status = "complete";
      const row = await queryOne(
        pool,
        `INSERT INTO ingest_session_messages (
          id, session_id, role, content, message_type, attachment_id,
          stream_status, wiki_refs_json, exclude_from_archive, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${NOW_TEXT})
        RETURNING ${MESSAGE_COLUMNS}`,
        [
          randomUUID(),
          msg.session_id,
          msg.role,
          msg.content,
          msg.message_type,
          msg.attachment_id.trim(),
          msg.stream_status,
          normalizeWikiRefs(msg.wiki_refs_json),
          msg.exclude_from_archive,
        ],
      );
      if (!row) throw new Error("create session message: no row returned");
      Object.assign(msg, scanMessage(row));
      await exec(pool, `UPDATE ingest_sessions SET updated_at = ${NOW_TEXT} WHERE id = $1`, [
        msg.session_id,
      ]);
    },

    async getIngestSessionMessage(id: string): Promise<IngestSessionMessage | null> {
      const row = await queryOne(
        pool,
        `SELECT ${MESSAGE_COLUMNS} FROM ingest_session_messages WHERE id = $1`,
        [id],
      );
      return row ? scanMessage(row) : null;
    },

    async listIngestSessionMessages(sessionID: string): Promise<IngestSessionMessage[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${MESSAGE_COLUMNS}
         FROM ingest_session_messages
         WHERE session_id = $1
         ORDER BY created_at ASC, id ASC`,
        [sessionID],
      );
      return rows.map(scanMessage);
    },

    async updateIngestSessionMessageContent(
      id: string,
      content: string,
      streamStatus: string,
    ): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_session_messages
         SET content = $1, stream_status = $2
         WHERE id = $3`,
        [content, streamStatus, id],
      );
    },

    async updateIngestSessionMessageExclude(id: string, exclude: boolean): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_session_messages SET exclude_from_archive = $1 WHERE id = $2`,
        [exclude, id],
      );
    },

    async countUserSessionMessages(sessionID: string): Promise<number> {
      const row = await queryOne<[number]>(
        pool,
        `SELECT COUNT(*) FROM ingest_session_messages
         WHERE session_id = $1 AND role = 'user'`,
        [sessionID],
      );
      return row ? asNumber(row[0]) : 0;
    },

    async upsertSessionReference(
      sessionID: string,
      documentID: string,
      relativePath: string,
      title: string,
      source: string,
    ): Promise<void> {
      const session = sessionID.trim();
      const document = documentID.trim();
      if (!session || !document) {
        throw new Error("session_id and document_id are required");
      }
      const refSource = source.trim();
      if (
        refSource !== SESSION_REF_SOURCE_USER_MENTION &&
        refSource !== SESSION_REF_SOURCE_TOOL_READ
      ) {
        throw new Error(`invalid reference source "${source}"`);
      }
      await exec(
        pool,
        `INSERT INTO ingest_session_references (
          id, session_id, document_id, relative_path, title, source, first_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, ${NOW_TEXT})
        ON CONFLICT (session_id, document_id) DO UPDATE SET
          relative_path = excluded.relative_path,
          title = excluded.title,
          source = CASE
            WHEN ingest_session_references.source = $7 AND excluded.source = $8 THEN ingest_session_references.source
            WHEN ingest_session_references.source = $7 THEN ingest_session_references.source
            ELSE excluded.source
          END`,
        [
          randomUUID(),
          session,
          document,
          relativePath,
          title,
          refSource,
          SESSION_REF_SOURCE_USER_MENTION,
          SESSION_REF_SOURCE_TOOL_READ,
        ],
      );
    },

    async listSessionReferences(sessionID: string): Promise<IngestSessionReference[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${REFERENCE_COLUMNS}
         FROM ingest_session_references
         WHERE session_id = $1
         ORDER BY first_seen_at ASC, id ASC`,
        [sessionID],
      );
      return rows.map(scanReference);
    },

    async countSessionReference(sessionID: string, documentID: string): Promise<number> {
      const row = await queryOne<[number]>(
        pool,
        `SELECT COUNT(*) FROM ingest_session_references
         WHERE session_id = $1 AND document_id = $2`,
        [sessionID, documentID],
      );
      return row ? asNumber(row[0]) : 0;
    },

    async insertSessionMessageEvent(
      messageID: string,
      step: string,
      phase: string,
      message: string,
      payload: Record<string, unknown>,
      maxPerMessage: number,
    ): Promise<void> {
      const limit =
        maxPerMessage > 0 ? maxPerMessage : DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT;
      const payloadJSON = payload ? JSON.stringify(payload) : "";
      await exec(
        pool,
        `INSERT INTO session_message_events (message_id, step, phase, message, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})`,
        [messageID, step, phase, message, payloadJSON],
      );
      await trimMessageEvents(messageID, limit);
    },

    async listSessionMessageEvents(messageID: string, limit: number): Promise<SessionMessageEvent[]> {
      const effectiveLimit = limit <= 0 || limit > 500 ? 500 : limit;
      const rows = await queryRows(
        pool,
        `SELECT id, message_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
         FROM session_message_events
         WHERE message_id = $1
         ORDER BY id ASC
         LIMIT $2`,
        [messageID, effectiveLimit],
      );
      return rows.map((row) => ({
        id: asNumber(row[0]),
        message_id: asString(row[1]),
        step: asString(row[2]),
        phase: asString(row[3]),
        message: asString(row[4]),
        payload: asString(row[5]),
        created_at: asString(row[6]),
      }));
    },

    async trimSessionMessageEvents(messageID: string, maxCount: number): Promise<void> {
      await trimMessageEvents(messageID, maxCount);
    },

    async getSessionMsgEventsMaxCount(): Promise<number> {
      return clampMsgEventsMaxCount(await configValue(pool, "session_message_events_max_count"));
    },
  };
}
