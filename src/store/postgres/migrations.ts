import type { Pool } from "pg";

export interface Migration {
  version: number;
  statements: string[];
}

const nowText = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE EXTENSION IF NOT EXISTS vector`,
      `CREATE EXTENSION IF NOT EXISTS pg_trgm`,

      `CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,

      `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        title TEXT,
        path TEXT NOT NULL DEFAULT '/',
        relative_path TEXT NOT NULL UNIQUE,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('wiki','source','asset')),
        file_type TEXT NOT NULL,
        file_size BIGINT NOT NULL DEFAULT 0,
        document_number BIGINT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
        page_count BIGINT,
        content TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        date TEXT,
        metadata TEXT,
        error_message TEXT,
        version BIGINT NOT NULL DEFAULT 0,
        parser TEXT,
        content_hash TEXT,
        mtime_ns BIGINT,
        last_indexed_at TEXT,
        stale_since TEXT,
        highlights TEXT NOT NULL DEFAULT '[]',
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_source_kind ON documents(source_kind)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_filename_trgm ON documents USING gin (filename gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING gin (title gin_trgm_ops)`,

      `CREATE TABLE IF NOT EXISTS document_pages (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,
        content TEXT NOT NULL,
        elements TEXT,
        UNIQUE(document_id, page)
      )`,

      `CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        page INTEGER,
        start_char INTEGER,
        token_count INTEGER NOT NULL,
        header_breadcrumb TEXT,
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        UNIQUE(document_id, chunk_index)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING gin (to_tsvector('simple', content))`,
      `CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm ON document_chunks USING gin (content gin_trgm_ops)`,

      `CREATE TABLE IF NOT EXISTS document_references (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        target_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        reference_type TEXT NOT NULL CHECK (reference_type IN ('cites','links_to')),
        page INTEGER,
        UNIQUE(source_document_id, target_document_id, reference_type)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_refs_source ON document_references(source_document_id)`,
      `CREATE INDEX IF NOT EXISTS idx_refs_target ON document_references(target_document_id)`,

      `CREATE TABLE IF NOT EXISTS source_blobs (
        id TEXT PRIMARY KEY,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        filename TEXT NOT NULL,
        media_type TEXT NOT NULL DEFAULT '',
        size BIGINT NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL UNIQUE,
        bytes BYTEA NOT NULL,
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,

      `CREATE TABLE IF NOT EXISTS change_sets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('ingest','review_apply','rollback','manual','delete','import')),
        job_id TEXT NOT NULL DEFAULT '',
        review_id TEXT NOT NULL DEFAULT '',
        source_blob_id TEXT NOT NULL DEFAULT '',
        source_filename TEXT NOT NULL DEFAULT '',
        normalized_content TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        rollback_of TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_change_sets_created ON change_sets(created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS page_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        revision_no INTEGER NOT NULL,
        parent_revision_id TEXT NOT NULL DEFAULT '',
        change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
        operation TEXT NOT NULL CHECK (operation IN ('create','update','delete','restore')),
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        source_kind TEXT NOT NULL DEFAULT '',
        file_type TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        UNIQUE(document_id, revision_no)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_revisions_change_set ON page_revisions(change_set_id)`,
      `CREATE INDEX IF NOT EXISTS idx_revisions_path ON page_revisions(relative_path, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id TEXT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        embedding vector NOT NULL,
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        PRIMARY KEY (chunk_id, model)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model)`,

      `CREATE TABLE IF NOT EXISTS ingest_jobs (
        id TEXT PRIMARY KEY,
        parent_job_id TEXT REFERENCES ingest_jobs(id) ON DELETE SET NULL,
        input_type TEXT NOT NULL DEFAULT 'file',
        source_path TEXT NOT NULL,
        source_ref TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
        retries INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        error TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        missing_dependency TEXT NOT NULL DEFAULT '',
        remediation TEXT NOT NULL DEFAULT '',
        result_summary TEXT NOT NULL DEFAULT '',
        runner_id TEXT NOT NULL DEFAULT '',
        heartbeat_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_jobs_created_at ON ingest_jobs(created_at)`,

      `CREATE TABLE IF NOT EXISTS ingest_job_events (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        phase TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON ingest_job_events(job_id, id DESC)`,

      `CREATE TABLE IF NOT EXISTS ingest_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        storage_path TEXT NOT NULL DEFAULT '',
        llm_instance_id TEXT NOT NULL DEFAULT '',
        llm_model TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'ingest' CHECK (mode IN ('ingest','qa','organize')),
        agent_kind TEXT NOT NULL DEFAULT 'native' CHECK (agent_kind IN ('native','acp')),
        acp_agent_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,

      `CREATE TABLE IF NOT EXISTS ingest_session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES ingest_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','attachment_summary')),
        attachment_id TEXT NOT NULL DEFAULT '',
        stream_status TEXT NOT NULL DEFAULT 'complete' CHECK (stream_status IN ('streaming','complete','incomplete','failed')),
        wiki_refs_json TEXT NOT NULL DEFAULT '',
        exclude_from_archive BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_session_messages_session ON ingest_session_messages(session_id, created_at)`,

      `CREATE TABLE IF NOT EXISTS ingest_session_references (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES ingest_sessions(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('user_mention','tool_read')),
        first_seen_at TEXT NOT NULL DEFAULT (${nowText}),
        UNIQUE(session_id, document_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_session_refs_session ON ingest_session_references(session_id, first_seen_at)`,

      `CREATE TABLE IF NOT EXISTS ingest_reviews (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        archive_source_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','ready_for_review','revising','approved','applying','succeeded','failed','cancelled')),
        current_plan_version INTEGER NOT NULL DEFAULT 0,
        approved_plan_version INTEGER NOT NULL DEFAULT 0,
        final_job_id TEXT NOT NULL DEFAULT '',
        change_set_id TEXT NOT NULL DEFAULT '',
        deep_organize BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_reviews_status ON ingest_reviews(status)`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_reviews_session ON ingest_reviews(session_id)`,

      `CREATE TABLE IF NOT EXISTS ingest_review_messages (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES ingest_reviews(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        message_type TEXT NOT NULL DEFAULT 'feedback' CHECK (message_type IN ('feedback','plan_summary','status_note')),
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_review_messages_review ON ingest_review_messages(review_id, created_at)`,

      `CREATE TABLE IF NOT EXISTS ingest_review_plans (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES ingest_reviews(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        plan_markdown TEXT NOT NULL DEFAULT '',
        plan_json TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        UNIQUE(review_id, version)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ingest_review_plans_review ON ingest_review_plans(review_id, version)`,

      `CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,

      `CREATE TABLE IF NOT EXISTS provider_instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        catalog_id TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        updated_at TEXT NOT NULL DEFAULT (${nowText})
      )`,

      `CREATE TABLE IF NOT EXISTS provider_info_cache (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        api_base TEXT NOT NULL DEFAULT '',
        api_format TEXT NOT NULL DEFAULT 'openai' CHECK (api_format IN ('openai','anthropic','ollama')),
        env_key TEXT NOT NULL DEFAULT '',
        doc_url TEXT NOT NULL DEFAULT ''
      )`,

      `CREATE TABLE IF NOT EXISTS provider_models_cache (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        family TEXT NOT NULL DEFAULT '',
        context_limit INTEGER NOT NULL DEFAULT 0,
        output_limit INTEGER NOT NULL DEFAULT 0,
        cost_input DOUBLE PRECISION NOT NULL DEFAULT 0,
        cost_output DOUBLE PRECISION NOT NULL DEFAULT 0,
        reasoning BOOLEAN NOT NULL DEFAULT FALSE,
        tool_call BOOLEAN NOT NULL DEFAULT FALSE,
        attachment BOOLEAN NOT NULL DEFAULT FALSE,
        modalities TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, model_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models_cache(provider_id)`,

      `CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGSERIAL PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (${nowText}),
        level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        resource_type TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_category_created_at ON activity_logs(category, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS legacy_mapping (
        legacy_sha TEXT PRIMARY KEY,
        change_set_id TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS session_message_events (
        id BIGSERIAL PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES ingest_session_messages(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        phase TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${nowText})
      )`,
      `CREATE INDEX IF NOT EXISTS idx_session_msg_events_message ON session_message_events(message_id, id DESC)`,
    ],
  },
];

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (${nowText})
    )`,
  );
  const { rows } = await pool.query<{ current: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS current FROM schema_migrations`,
  );
  const current = rows[0]?.current ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of migration.statements) {
        try {
          await client.query(statement);
        } catch (error) {
          if (statement.trim().startsWith("CREATE EXTENSION") && isConcurrentExtensionError(error)) {
            continue;
          }
          throw error;
        }
      }
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [migration.version]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${migration.version}: ${errorMessage(error)}`);
    } finally {
      client.release();
    }
  }
}

function isConcurrentExtensionError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("already exists") || message.includes("duplicate key value");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
