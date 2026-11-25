import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { folderPathFromWikiRelPath, resolvePageType } from "../../engine/wiki_org.js";
import type { RevisionStore } from "../interfaces.js";
import type { ChangeSet, Chunk, Document, PageRevision, PageWrite, RefEdge, RevisionOperation } from "../types.js";
import { parseStringArrayJson, stringArrayJson, syncDocumentMetaFromContent } from "./doc_meta.js";
import { ensureFolderAncestorsTx, releaseSoftDeletedPath } from "./folders.js";
import { NOW_TEXT, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const REVISION_COLUMNS = `
  r.id, r.document_id, r.relative_path, r.revision_no, r.parent_revision_id,
  r.change_set_id, r.operation, r.title, r.content, r.metadata, r.content_hash,
  r.source_kind, r.file_type, r.actor, r.created_at`;

const CHANGE_SET_COLUMNS = `
  cs.id, cs.kind, cs.job_id, cs.review_id, cs.source_blob_id, cs.source_filename,
  cs.normalized_content, cs.summary, cs.rollback_of, cs.created_at,
  (SELECT COUNT(*) FROM page_revisions pr WHERE pr.change_set_id = cs.id)`;

const REVISION_DOCUMENT_COLUMNS = `
  COALESCE(id, ''), COALESCE(user_id, ''), COALESCE(filename, ''), COALESCE(title, ''),
  COALESCE(path, ''), COALESCE(relative_path, ''), COALESCE(source_kind, ''),
  COALESCE(file_type, ''), COALESCE(file_size, 0), COALESCE(document_number, 0),
  COALESCE(status, ''), COALESCE(page_count, 0), COALESCE(content, ''),
  COALESCE(tags, '[]'), COALESCE(date, ''), COALESCE(metadata, ''),
  COALESCE(error_message, ''), COALESCE(version, 0), COALESCE(parser, ''),
  COALESCE(content_hash, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
  COALESCE(created_at, ''), COALESCE(updated_at, ''), COALESCE(deleted_at, ''),
  COALESCE(page_type, ''),
  COALESCE(confidence, ''), COALESCE(page_status, ''), COALESCE(experience_kind, ''),
  COALESCE(last_verified, ''), COALESCE(review_after, ''), COALESCE(archived_at, ''),
  COALESCE(archive_reason, ''), COALESCE(superseded_by, ''),
  COALESCE(aliases, '[]'), COALESCE(symptoms, '[]')`;

function scanRevision(row: unknown[]): PageRevision {
  return {
    id: asString(row[0]),
    document_id: asString(row[1]),
    relative_path: asString(row[2]),
    revision_no: asNumber(row[3]),
    parent_revision_id: asString(row[4]),
    change_set_id: asString(row[5]),
    operation: asString(row[6]) as RevisionOperation,
    title: asString(row[7]),
    content: asString(row[8]),
    metadata: asString(row[9]),
    content_hash: asString(row[10]),
    source_kind: asString(row[11]),
    file_type: asString(row[12]),
    actor: asString(row[13]),
    created_at: asString(row[14]),
  };
}

function scanChangeSet(row: unknown[]): ChangeSet {
  return {
    id: asString(row[0]),
    kind: asString(row[1]),
    job_id: asString(row[2]),
    review_id: asString(row[3]),
    source_blob_id: asString(row[4]),
    source_filename: asString(row[5]),
    normalized_content: asString(row[6]),
    summary: asString(row[7]),
    rollback_of: asString(row[8]),
    created_at: asString(row[9]),
    page_count: asNumber(row[10]),
  };
}

function scanRevisionDocument(row: unknown[]): Document {
  const tagsRaw = asString(row[13]);
  let tags: string[] = [];
  if (tagsRaw) {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = [];
    }
  }
  return {
    id: asString(row[0]),
    user_id: asString(row[1]),
    filename: asString(row[2]),
    title: asString(row[3]),
    path: asString(row[4]),
    relative_path: asString(row[5]),
    source_kind: asString(row[6]),
    file_type: asString(row[7]),
    file_size: asNumber(row[8]),
    document_number: asNumber(row[9]),
    status: asString(row[10]),
    page_count: asNumber(row[11]),
    content: asString(row[12]),
    tags,
    date: asString(row[14]),
    metadata: asString(row[15]),
    error_message: asString(row[16]),
    version: asNumber(row[17]),
    parser: asString(row[18]),
    content_hash: asString(row[19]),
    stale_since: asString(row[20]),
    highlights: asString(row[21]),
    created_at: asString(row[22]),
    updated_at: asString(row[23]),
    deleted_at: asString(row[24]),
    page_type: asString(row[25]),
    confidence: asString(row[26]),
    page_status: asString(row[27]),
    experience_kind: asString(row[28]),
    last_verified: asString(row[29]),
    review_after: asString(row[30]),
    archived_at: asString(row[31]),
    archive_reason: asString(row[32]),
    superseded_by: asString(row[33]),
    aliases: parseStringArrayJson(asString(row[34])),
    symptoms: parseStringArrayJson(asString(row[35])),
  };
}

function actorForKind(kind: string): string {
  switch (kind) {
    case "ingest":
      return "ingest";
    case "review_apply":
      return "review";
    case "rollback":
      return "rollback";
    case "import":
      return "migration";
    default:
      return "api";
  }
}

function pathDir(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  if (dir === "." || dir === "/") return "/";
  return `/${dir.replace(/^\/+/, "")}/`;
}

function writePath(write: PageWrite): string {
  return write.document ? write.document.relative_path : write.relative_path;
}

async function lockWorkspace(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))");
}

async function insertChangeSet(client: PoolClient, changeSet: ChangeSet): Promise<void> {
  await client.query(
    `INSERT INTO change_sets (id, kind, job_id, review_id, source_blob_id, source_filename,
      normalized_content, summary, rollback_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      changeSet.id,
      changeSet.kind,
      changeSet.job_id ?? "",
      changeSet.review_id ?? "",
      changeSet.source_blob_id ?? "",
      changeSet.source_filename ?? "",
      changeSet.normalized_content ?? "",
      changeSet.summary ?? "",
      changeSet.rollback_of ?? "",
    ],
  );
}

async function findDocumentForUpdate(
  client: PoolClient,
  id: string,
  relPath: string,
): Promise<Document | null> {
  if (id) {
    const row = await queryOne(
      client,
      `SELECT ${REVISION_DOCUMENT_COLUMNS} FROM documents WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (row) return scanRevisionDocument(row);
  }
  const row = await queryOne(
    client,
    `SELECT ${REVISION_DOCUMENT_COLUMNS} FROM documents WHERE relative_path=$1 FOR UPDATE`,
    [relPath],
  );
  return row ? scanRevisionDocument(row) : null;
}

async function insertRevision(
  client: PoolClient,
  changeSetID: string,
  kind: string,
  documentID: string,
  relPath: string,
  operation: RevisionOperation,
  doc: Document,
): Promise<void> {
  let parentID = "";
  let revisionNo = 1;
  const latest = await queryOne<[string, number]>(
    client,
    "SELECT id, revision_no FROM page_revisions WHERE document_id=$1 ORDER BY revision_no DESC LIMIT 1",
    [documentID],
  );
  if (latest) {
    parentID = asString(latest[0]);
    const parentNo = asNumber(latest[1]);
    if (parentNo > 0) revisionNo = parentNo + 1;
  }
  await client.query(
    `INSERT INTO page_revisions (id, document_id, relative_path, revision_no, parent_revision_id,
      change_set_id, operation, title, content, metadata, content_hash, source_kind,
      file_type, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      randomUUID(),
      documentID,
      relPath,
      revisionNo,
      parentID,
      changeSetID,
      operation,
      doc.title,
      doc.content,
      doc.metadata,
      doc.content_hash,
      doc.source_kind,
      doc.file_type,
      actorForKind(kind),
    ],
  );
}

async function replaceChunks(client: PoolClient, docID: string, chunks: Chunk[]): Promise<void> {
  await client.query("DELETE FROM document_chunks WHERE document_id=$1", [docID]);
  for (const chunk of chunks) {
    await client.query(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, page, start_char, token_count, header_breadcrumb)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        docID,
        chunk.chunk_index,
        chunk.content,
        chunk.page,
        chunk.start_char,
        chunk.token_count,
        chunk.header_breadcrumb,
      ],
    );
  }
}

async function replaceRefs(client: PoolClient, sourceID: string, refs: RefEdge[]): Promise<void> {
  await client.query("DELETE FROM document_references WHERE source_document_id=$1", [sourceID]);
  for (const edge of refs) {
    await client.query(
      `INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_document_id, target_document_id, reference_type) DO NOTHING`,
      [randomUUID(), edge.source_id, edge.target_id, edge.ref_type, edge.page],
    );
  }
}

async function applyPageWrite(
  client: PoolClient,
  changeSetID: string,
  kind: string,
  write: PageWrite,
): Promise<void> {
  const relPath = writePath(write);
  if (!relPath) throw new Error("relative path is required");

  const existing = await findDocumentForUpdate(client, write.document?.id ?? "", relPath);

  if (!write.document) {
    if (!existing) throw new Error(`document not found: ${relPath}`);
    await client.query(
      `UPDATE documents SET deleted_at = (${NOW_TEXT}), updated_at = (${NOW_TEXT}) WHERE id = $1`,
      [existing.id],
    );
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [existing.id]);
    await client.query("DELETE FROM document_references WHERE source_document_id = $1", [existing.id]);
    await insertRevision(
      client,
      changeSetID,
      kind,
      existing.id,
      relPath,
      write.operation || "delete",
      existing,
    );
    return;
  }

  const doc: Document = { ...write.document, tags: [...(write.document.tags ?? [])] };
  doc.relative_path = relPath;
  if (!doc.path) doc.path = pathDir(relPath);
  if (!doc.filename) doc.filename = path.posix.basename(relPath);
  if (!doc.user_id) doc.user_id = "default";
  if (!doc.status) doc.status = "ready";
  syncDocumentMetaFromContent(doc);
  doc.page_type =
    doc.source_kind === "wiki"
      ? resolvePageType("", doc.page_type ?? "", relPath)
      : (doc.page_type ?? "");

  if (!existing) {
    await releaseSoftDeletedPath(client, relPath);
    if (!doc.id) doc.id = randomUUID();
    if (!doc.document_number) {
      const row = await queryOne<[number]>(
        client,
        "SELECT COALESCE(MAX(document_number), 0) + 1 FROM documents",
      );
      doc.document_number = row ? asNumber(row[0]) : 1;
    }
    await client.query(
      `INSERT INTO documents (id, user_id, filename, title, path, relative_path, source_kind,
        file_type, file_size, document_number, status, page_count, content, tags, date,
        metadata, error_message, version, parser, content_hash, stale_since, highlights,
        page_type, confidence, page_status, experience_kind, last_verified, review_after,
        archived_at, archive_reason, superseded_by, aliases, symptoms,
        deleted_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'',${NOW_TEXT},${NOW_TEXT})`,
      [
        doc.id,
        doc.user_id,
        doc.filename,
        doc.title,
        doc.path,
        doc.relative_path,
        doc.source_kind,
        doc.file_type,
        doc.file_size,
        doc.document_number,
        doc.status,
        doc.page_count,
        doc.content,
        JSON.stringify(doc.tags),
        doc.date,
        doc.metadata,
        doc.error_message,
        doc.version,
        doc.parser,
        doc.content_hash,
        doc.stale_since,
        doc.highlights,
        doc.page_type,
        doc.confidence ?? "",
        doc.page_status ?? "",
        doc.experience_kind ?? "",
        doc.last_verified ?? "",
        doc.review_after ?? "",
        doc.archived_at ?? "",
        doc.archive_reason ?? "",
        doc.superseded_by ?? "",
        stringArrayJson(doc.aliases),
        stringArrayJson(doc.symptoms),
      ],
    );
  } else {
    doc.id = existing.id;
    if (!doc.document_number) doc.document_number = existing.document_number;
    if (existing.relative_path !== relPath) {
      await releaseSoftDeletedPath(client, relPath);
    }
    await client.query(
      `UPDATE documents SET user_id=$2, filename=$3, title=$4, path=$5, relative_path=$6,
        source_kind=$7, file_type=$8, file_size=$9, document_number=$10, status=$11,
        page_count=$12, content=$13, tags=$14, date=$15, metadata=$16, error_message=$17,
        version=$18, parser=$19, content_hash=$20, stale_since=$21, highlights=$22,
        page_type=$23, confidence=$24, page_status=$25, experience_kind=$26,
        last_verified=$27, review_after=$28, archived_at=$29, archive_reason=$30,
        superseded_by=$31, aliases=$32, symptoms=$33, deleted_at='', updated_at=(${NOW_TEXT})
       WHERE id=$1`,
      [
        doc.id,
        doc.user_id,
        doc.filename,
        doc.title,
        doc.path,
        doc.relative_path,
        doc.source_kind,
        doc.file_type,
        doc.file_size,
        doc.document_number,
        doc.status,
        doc.page_count,
        doc.content,
        JSON.stringify(doc.tags),
        doc.date,
        doc.metadata,
        doc.error_message,
        existing.version + 1,
        doc.parser,
        doc.content_hash,
        doc.stale_since,
        doc.highlights,
        doc.page_type,
        doc.confidence ?? "",
        doc.page_status ?? "",
        doc.experience_kind ?? "",
        doc.last_verified ?? "",
        doc.review_after ?? "",
        doc.archived_at ?? "",
        doc.archive_reason ?? "",
        doc.superseded_by ?? "",
        stringArrayJson(doc.aliases),
        stringArrayJson(doc.symptoms),
      ],
    );
    doc.version = existing.version + 1;
  }

  if (doc.source_kind === "wiki") {
    const folder = folderPathFromWikiRelPath(relPath);
    if (folder) await ensureFolderAncestorsTx(client, folder);
  }

  const operation: RevisionOperation =
    write.operation || (existing ? "update" : "create");
  await insertRevision(client, changeSetID, kind, doc.id, relPath, operation, doc);
  await replaceChunks(client, doc.id, write.chunks);
  await replaceRefs(client, doc.id, write.refs);
}

async function queryRevisions(client: Pool | PoolClient, suffix: string, args: unknown[]): Promise<PageRevision[]> {
  const rows = await queryRows(client, `SELECT ${REVISION_COLUMNS} FROM page_revisions r ${suffix}`, args);
  return rows.map(scanRevision);
}

function documentFromRevision(revision: PageRevision): Document {
  const doc: Document = {
    id: revision.document_id ?? "",
    user_id: "default",
    filename: path.posix.basename(revision.relative_path),
    title: revision.title,
    path: pathDir(revision.relative_path),
    relative_path: revision.relative_path,
    source_kind: revision.source_kind,
    file_type: revision.file_type,
    file_size: 0,
    document_number: 0,
    status: "ready",
    page_count: 0,
    content: revision.content,
    tags: [],
    date: "",
    metadata: revision.metadata,
    error_message: "",
    version: 0,
    parser: "",
    content_hash: revision.content_hash,
    stale_since: "",
    highlights: "",
    created_at: "",
    updated_at: "",
  };
  syncDocumentMetaFromContent(doc);
  return doc;
}

export function revisionsRepo(pool: Pool): RevisionStore {
  return {
    async applyChangeSet(changeSet: ChangeSet, writes: PageWrite[]): Promise<void> {
      if (!changeSet) throw new Error("nil change set");
      if (!changeSet.kind) throw new Error("change set kind is required");
      await withTransaction(pool, async (client) => {
        await lockWorkspace(client);
        if (!changeSet.id) changeSet.id = randomUUID();
        await insertChangeSet(client, changeSet);
        for (const write of writes) {
          if (write.document && !write.document.id) write.document.id = randomUUID();
          await applyPageWrite(client, changeSet.id, changeSet.kind, write);
        }
      });
    },

    async getChangeSet(id: string): Promise<ChangeSet | null> {
      const row = await queryOne(
        pool,
        `SELECT ${CHANGE_SET_COLUMNS} FROM change_sets cs WHERE cs.id=$1`,
        [id],
      );
      return row ? scanChangeSet(row) : null;
    },

    async listChangeSets(limit: number, before: string): Promise<ChangeSet[]> {
      const effectiveLimit = limit <= 0 || limit > 200 ? 50 : limit;
      const rows = await queryRows(
        pool,
        `SELECT ${CHANGE_SET_COLUMNS} FROM change_sets cs
         WHERE ($1 = '' OR cs.created_at < $1) ORDER BY cs.created_at DESC, cs.id DESC LIMIT $2`,
        [before, effectiveLimit],
      );
      return rows.map(scanChangeSet);
    },

    async listChangeSetRevisions(changeSetID: string): Promise<PageRevision[]> {
      return queryRevisions(pool, "WHERE r.change_set_id=$1 ORDER BY r.relative_path, r.revision_no", [
        changeSetID,
      ]);
    },

    async listPageRevisions(relativePathOrDocId: string, limit: number): Promise<PageRevision[]> {
      const effectiveLimit = limit <= 0 ? 100 : limit;
      const docRow = await queryOne<[string]>(
        pool,
        `SELECT id FROM documents WHERE id = $1 OR relative_path = $1 LIMIT 1`,
        [relativePathOrDocId],
      );
      if (docRow) {
        return queryRevisions(
          pool,
          "WHERE r.document_id=$1 ORDER BY r.revision_no DESC LIMIT $2",
          [asString(docRow[0]), effectiveLimit],
        );
      }
      const revRow = await queryOne<[string]>(
        pool,
        `SELECT document_id FROM page_revisions WHERE relative_path=$1 ORDER BY revision_no DESC LIMIT 1`,
        [relativePathOrDocId],
      );
      if (revRow) {
        return queryRevisions(
          pool,
          "WHERE r.document_id=$1 ORDER BY r.revision_no DESC LIMIT $2",
          [asString(revRow[0]), effectiveLimit],
        );
      }
      return [];
    },

    async latestRevision(documentID: string): Promise<PageRevision | null> {
      const row = await queryOne(
        pool,
        `SELECT ${REVISION_COLUMNS} FROM page_revisions r
         WHERE r.document_id=$1 ORDER BY r.revision_no DESC LIMIT 1`,
        [documentID],
      );
      return row ? scanRevision(row) : null;
    },

    async getRevision(id: string): Promise<PageRevision | null> {
      const row = await queryOne(
        pool,
        `SELECT ${REVISION_COLUMNS} FROM page_revisions r WHERE r.id=$1`,
        [id],
      );
      return row ? scanRevision(row) : null;
    },

    async undoChangeSet(changeSetID: string, actor: string): Promise<ChangeSet> {
      return withTransaction(pool, async (client) => {
        await lockWorkspace(client);
        const targetRow = await queryOne(
          client,
          `SELECT ${CHANGE_SET_COLUMNS} FROM change_sets cs WHERE cs.id=$1`,
          [changeSetID],
        );
        if (!targetRow) throw new Error(`load change set: not found ${changeSetID}`);
        const target = scanChangeSet(targetRow);
        const revisions = await queryRevisions(
          client,
          "WHERE r.change_set_id=$1 ORDER BY r.document_id, r.revision_no",
          [changeSetID],
        );
        const latest = new Map<string, PageRevision>();
        for (const revision of revisions) {
          const key = revision.document_id ?? "";
          const previous = latest.get(key);
          if (!previous || revision.revision_no > previous.revision_no) latest.set(key, revision);
        }
        const ordered = [...latest.values()].sort((a, b) =>
          (a.relative_path ?? "").localeCompare(b.relative_path ?? ""),
        );

        const newChangeSet: ChangeSet = {
          id: randomUUID(),
          kind: "rollback",
          rollback_of: changeSetID,
          summary: `rollback: ${target.summary}`,
          page_count: 0,
          created_at: "",
        };
        await insertChangeSet(client, newChangeSet);

        for (const revision of ordered) {
          let write: PageWrite;
          if (revision.operation === "create" || !revision.parent_revision_id) {
            write = {
              relative_path: revision.relative_path,
              document: null,
              operation: "delete",
              chunks: [],
              refs: [],
            };
          } else {
            const parentRow = await queryOne(
              client,
              `SELECT ${REVISION_COLUMNS} FROM page_revisions r WHERE r.id=$1`,
              [revision.parent_revision_id],
            );
            if (parentRow) {
              const parentRev = scanRevision(parentRow);
              write = {
                relative_path: parentRev.relative_path,
                document: documentFromRevision(parentRev),
                operation: "restore",
                chunks: [],
                refs: [],
              };
            } else {
              write = {
                relative_path: revision.relative_path,
                document: null,
                operation: "delete",
                chunks: [],
                refs: [],
              };
            }
          }
          await applyPageWrite(client, newChangeSet.id, newChangeSet.kind, write);
          newChangeSet.page_count += 1;
        }

        newChangeSet.created_at = nowString();
        return newChangeSet;
      });
    },

    async restoreRevision(revisionID: string, actor: string): Promise<ChangeSet> {
      return withTransaction(pool, async (client) => {
        await lockWorkspace(client);
        const revisionRow = await queryOne(
          client,
          `SELECT ${REVISION_COLUMNS} FROM page_revisions r WHERE r.id=$1`,
          [revisionID],
        );
        if (!revisionRow) throw new Error(`load revision: not found ${revisionID}`);
        const revision = scanRevision(revisionRow);
        const newChangeSet: ChangeSet = {
          id: randomUUID(),
          kind: "rollback",
          rollback_of: revision.change_set_id,
          summary: `restore revision ${revision.revision_no} of ${revision.relative_path}`,
          page_count: 1,
          created_at: "",
        };
        await insertChangeSet(client, newChangeSet);
        const write: PageWrite =
          revision.operation === "delete"
            ? {
                relative_path: revision.relative_path,
                document: null,
                operation: "delete",
                chunks: [],
                refs: [],
              }
            : {
                relative_path: revision.relative_path,
                document: documentFromRevision(revision),
                operation: "restore",
                chunks: [],
                refs: [],
              };
        await applyPageWrite(client, newChangeSet.id, newChangeSet.kind, write);
        newChangeSet.created_at = nowString();
        return newChangeSet;
      });
    },

    async seedInitialRevisions(actor: string): Promise<number> {
      const effectiveActor = actor || "migration";
      return withTransaction(pool, async (client) => {
        await lockWorkspace(client);
        const rows = await queryRows(
          client,
          `SELECT d.id, d.relative_path, COALESCE(d.title,''), COALESCE(d.content,''),
            COALESCE(d.metadata,''), COALESCE(d.content_hash,''), COALESCE(d.source_kind,''),
            COALESCE(d.file_type,'')
           FROM documents d
           WHERE COALESCE(d.deleted_at,'') = ''
             AND NOT EXISTS (SELECT 1 FROM page_revisions r WHERE r.document_id = d.id)`,
        );
        if (rows.length === 0) return 0;
        const changeSet: ChangeSet = {
          id: randomUUID(),
          kind: "import",
          summary: `import ${rows.length} page(s)`,
          page_count: rows.length,
          created_at: "",
        };
        await insertChangeSet(client, changeSet);
        for (const row of rows) {
          await client.query(
            `INSERT INTO page_revisions (id, document_id, relative_path, revision_no, parent_revision_id,
              change_set_id, operation, title, content, metadata, content_hash, source_kind, file_type, actor)
             VALUES ($1,$2,$3,1,'',$4,'create',$5,$6,$7,$8,$9,$10,$11)`,
            [
              randomUUID(),
              asString(row[0]),
              asString(row[1]),
              changeSet.id,
              asString(row[2]),
              asString(row[3]),
              asString(row[4]),
              asString(row[5]),
              asString(row[6]),
              asString(row[7]),
              effectiveActor,
            ],
          );
        }
        return rows.length;
      });
    },
  };
}

function nowString(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

