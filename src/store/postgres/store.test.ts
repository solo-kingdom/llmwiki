import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore } from "./db.js";
import { FolderConflictError, FolderValidationError } from "./folders.js";
import type { Store } from "../interfaces.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("postgres store integration", () => {
  let pool: Pool;
  let store: Store;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    store = await openStore(pool);
    await pool.query("DELETE FROM workspace");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM documents WHERE relative_path LIKE $1 OR relative_path LIKE $2", [
      `integration-${suffix}%`,
      `wiki/tree-${suffix}%`,
    ]);
    await pool.query("DELETE FROM wiki_folders WHERE path LIKE $1", [`tree-${suffix}%`]);
    await pool.end();
  });

  it("round-trips workspace and config", async () => {
    await store.upsertWorkspace({
      id: `ws-${suffix}`,
      name: "integration",
      description: "",
      user_id: `integration-user-${suffix}`,
      created_at: "",
    });
    const workspace = await store.getWorkspace();
    expect(workspace?.name).toBe("integration");

    await store.setConfig(`integration_key_${suffix}`, "value");
    expect(await store.getConfig(`integration_key_${suffix}`)).toBe("value");
  });

  it("creates, lists, reads and archives documents", async () => {
    const relativePath = `integration-${suffix}/note.md`;
    const doc = {
      id: "",
      user_id: "default",
      filename: "note.md",
      title: "Integration Note",
      path: `/integration-${suffix}/`,
      relative_path: relativePath,
      source_kind: "source",
      file_type: "md",
      file_size: 4,
      document_number: 0,
      status: "ready",
      page_count: 0,
      content: "body",
      tags: ["integration"],
      date: "",
      metadata: "",
      error_message: "",
      version: 0,
      parser: "",
      content_hash: "hash",
      stale_since: "",
      highlights: "[]",
      created_at: "",
      updated_at: "",
    };

    await store.createDocument(doc);
    expect(doc.id).not.toBe("");

    const loaded = await store.getDocument(doc.id);
    expect(loaded?.title).toBe("Integration Note");
    expect(loaded?.tags).toEqual(["integration"]);

    const listed = await store.listDocumentsFiltered({ source_kind: "source" });
    expect(listed.some((item) => item.id === doc.id)).toBe(true);

    const archived = await store.archiveDocuments([doc.id]);
    expect(archived).toBe(1);
  });

  it("applies a change set with revisions and chunks", async () => {
    const relativePath = `integration-${suffix}/page.md`;
    const changeSet = {
      id: "",
      kind: "manual",
      summary: "integration",
      page_count: 1,
      created_at: "",
    };
    const document = {
      id: "",
      user_id: "default",
      filename: "page.md",
      title: "Page",
      path: `/integration-${suffix}/`,
      relative_path: relativePath,
      source_kind: "wiki",
      file_type: "md",
      file_size: 6,
      document_number: 0,
      status: "ready",
      page_count: 1,
      content: "# Page\n",
      tags: [],
      date: "",
      metadata: "",
      error_message: "",
      version: 0,
      parser: "",
      content_hash: "hash2",
      stale_since: "",
      highlights: "[]",
      created_at: "",
      updated_at: "",
    };

    await store.applyChangeSet(changeSet, [
      {
        relative_path: relativePath,
        document,
        operation: "create",
        chunks: [
          {
            id: "",
            document_id: "",
            chunk_index: 0,
            content: "# Page",
            page: 1,
            start_char: 0,
            token_count: 2,
            header_breadcrumb: "Page",
          },
        ],
        refs: [],
      },
    ]);

    const revisions = await store.listChangeSetRevisions(changeSet.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.operation).toBe("create");
    expect(await store.listPageRevisions(relativePath, 10)).toHaveLength(1);
  });

  it("creates jobs and appends events", async () => {
    const job = {
      id: "",
      parent_job_id: "",
      input_type: "text",
      source_path: `/tmp/integration-${suffix}.txt`,
      source_ref: "",
      status: "queued",
      retries: 0,
      max_retries: 3,
      error: "",
      error_code: "",
      error_message: "",
      missing_dependency: "",
      remediation: "",
      result_summary: "",
      created_at: "",
      updated_at: "",
    };
    await store.createIngestJob(job);
    expect((await store.getIngestJob(job.id))?.status).toBe("queued");

    await store.insertIngestJobEvent(job.id, "normalize", "done", "ok", { integration: true }, 200);
    expect(await store.listIngestJobEvents(job.id, 10)).toHaveLength(1);
  });

  it("verifies migration v4 backfill regex and folder creation on live PostgreSQL", async () => {
    const legacyId = randomUUID();
    const topicId = randomUUID();
    await pool.query(
      `INSERT INTO documents (id, user_id, filename, title, path, relative_path, source_kind, file_type, status, content, page_type)
       VALUES
       ($1, 'default', 'old.md', 'Old', '/wiki/concepts/', $2, 'wiki', 'md', 'ready', '# Old', ''),
       ($3, 'default', 'fm.md', 'FM', $4, $5, 'wiki', 'md', 'ready', $6, '')`,
      [
        legacyId,
        `wiki/concepts/legacy-${suffix}.md`,
        topicId,
        `/wiki/tree-${suffix}/ai/`,
        `wiki/tree-${suffix}/ai/fm.md`,
        `---\ntitle: FM\ntype: Concept\ndate: 2026-11-24\n---\n\n# FM\n`,
      ],
    );

    // Re-run the v4 backfill statements against empty page_type rows to verify PG ARE syntax
    await pool.query(`
      WITH fm AS (
        SELECT id,
          lower(COALESCE(
            substring(
              substring(content FROM '\\A---[ \\t]*\\r?\\n(.*?)\\r?\\n---[ \\t]*(?:\\r?\\n|$)')
              FROM '(?n)^type:[ \\t]*([a-zA-Z]+)[ \\t]*\\r?$'
            ),
            ''
          )) AS fm_type
        FROM documents
        WHERE page_type = ''
      )
      UPDATE documents d
      SET page_type = CASE
        WHEN d.source_kind != 'wiki' THEN ''
        WHEN d.relative_path LIKE 'wiki/templates/%' THEN 'template'
        WHEN d.relative_path LIKE 'wiki/sources/%' THEN 'source'
        WHEN fm.fm_type IN ('entity','concept','source','synthesis','comparison','query','page') THEN fm.fm_type
        WHEN d.relative_path LIKE 'wiki/entities/%' THEN 'entity'
        WHEN d.relative_path LIKE 'wiki/concepts/%' THEN 'concept'
        WHEN d.relative_path LIKE 'wiki/synthesis/%' THEN 'synthesis'
        WHEN d.relative_path LIKE 'wiki/comparisons/%' THEN 'comparison'
        WHEN d.relative_path LIKE 'wiki/queries/%' THEN 'query'
        ELSE 'page'
      END
      FROM fm
      WHERE d.id = fm.id
    `);

    const legacyDoc = await store.getDocument(legacyId);
    const topicDoc = await store.getDocument(topicId);
    expect(legacyDoc?.page_type).toBe("concept");
    expect(topicDoc?.page_type).toBe("concept");

    await pool.query("DELETE FROM documents WHERE id = ANY($1::text[])", [[legacyId, topicId]]);
  });

  it("supports folder CRUD, document move with link rewrite/history/undo, soft-delete collision, folder move and delete modes", async () => {
    const root = `tree-${suffix}`;
    const leaf = await store.createFolder({
      path: `${root}/sub/leaf`,
      display_name: "Leaf",
      description: "Leaf folder",
      sort_order: 2,
    });
    expect(leaf.path).toBe(`${root}/sub/leaf`);
    expect((await store.getFolder(`${root}/sub`))?.path).toBe(`${root}/sub`);

    await expect(store.createFolder({ path: `${root}/sub/leaf` })).rejects.toBeInstanceOf(FolderConflictError);

    const updated = await store.updateFolder(`${root}/sub/leaf`, { display_name: "Leaf Updated", sort_order: 5 });
    expect(updated?.display_name).toBe("Leaf Updated");
    expect(updated?.sort_order).toBe(5);

    const docAId = randomUUID();
    const docBId = randomUUID();
    const docAPath = `wiki/${root}/old/a.md`;
    const docBPath = `wiki/${root}/sub/b.md`;

    await store.applyChangeSet(
      { id: "", kind: "manual", summary: "seed tree docs", page_count: 2, created_at: "" },
      [
        {
          relative_path: docAPath,
          document: {
            id: docAId,
            user_id: "default",
            filename: "a.md",
            title: "Doc A",
            path: `/wiki/${root}/old/`,
            relative_path: docAPath,
            source_kind: "wiki",
            file_type: "md",
            file_size: 10,
            document_number: 0,
            status: "ready",
            page_count: 1,
            content: "---\ntitle: Doc A\ntype: concept\ndate: 2026-11-24\n---\n\n# Doc A\n",
            tags: [],
            date: "2026-11-24",
            metadata: "{}",
            error_message: "",
            version: 0,
            parser: "",
            content_hash: "h1",
            stale_since: "",
            highlights: "[]",
            created_at: "",
            updated_at: "",
            page_type: "concept",
          },
          operation: "create",
          chunks: [],
          refs: [],
        },
        {
          relative_path: docBPath,
          document: {
            id: docBId,
            user_id: "default",
            filename: "b.md",
            title: "Doc B",
            path: `/wiki/${root}/sub/`,
            relative_path: docBPath,
            source_kind: "wiki",
            file_type: "md",
            file_size: 20,
            document_number: 0,
            status: "ready",
            page_count: 1,
            content: `---\ntitle: Doc B\ntype: entity\ndate: 2026-11-24\n---\n\nSee [[${root}/old/a|A]] and [A](/wiki/${root}/old/a.md).\n`,
            tags: [],
            date: "2026-11-24",
            metadata: "{}",
            error_message: "",
            version: 0,
            parser: "",
            content_hash: "h2",
            stale_since: "",
            highlights: "[]",
            created_at: "",
            updated_at: "",
            page_type: "entity",
          },
          operation: "create",
          chunks: [],
          refs: [],
        },
      ],
    );

    const folders = await store.listFolders(true);
    const rootMeta = folders.find((f) => f.path === root);
    expect(rootMeta?.total_count).toBe(2);

    // Move Doc A and verify id preservation, link rewrite, cross-path history, and undo
    const moveRes = await store.moveDocument(docAId, `${root}/new`, "a-renamed.md", "test");
    expect(moveRes.document.id).toBe(docAId);
    expect(moveRes.document.relative_path).toBe(`wiki/${root}/new/a-renamed.md`);
    expect(moveRes.updated_link_paths).toContain(docBPath);

    const docBAfter = await store.getDocument(docBId);
    expect(docBAfter?.content).toContain(`[[${root}/new/a-renamed|A]]`);
    expect(docBAfter?.content).toContain(`[A](/wiki/${root}/new/a-renamed.md)`);

    const revisions = await store.listPageRevisions(moveRes.document.relative_path, 10);
    expect(revisions.map((r) => r.operation)).toEqual(["move", "create"]);

    await store.undoChangeSet(moveRes.change_set_id, "test");
    const docARestored = await store.getDocument(docAId);
    expect(docARestored?.relative_path).toBe(docAPath);

    // Soft-delete collision guard: create + delete at target path, then move Doc A there
    const collidePath = `wiki/${root}/new/collide.md`;
    const collideId = randomUUID();
    await store.applyChangeSet(
      { id: "", kind: "manual", summary: "seed collide", page_count: 1, created_at: "" },
      [
        {
          relative_path: collidePath,
          document: {
            id: collideId,
            user_id: "default",
            filename: "collide.md",
            title: "Collide",
            path: `/wiki/${root}/new/`,
            relative_path: collidePath,
            source_kind: "wiki",
            file_type: "md",
            file_size: 5,
            document_number: 0,
            status: "ready",
            page_count: 1,
            content: "# Collide\n",
            tags: [],
            date: "",
            metadata: "{}",
            error_message: "",
            version: 0,
            parser: "",
            content_hash: "hc",
            stale_since: "",
            highlights: "[]",
            created_at: "",
            updated_at: "",
            page_type: "page",
          },
          operation: "create",
          chunks: [],
          refs: [],
        },
      ],
    );
    await store.archiveDocuments([collideId]);
    const movedOverDeleted = await store.moveDocument(docAId, `${root}/new`, "collide.md", "test");
    expect(movedOverDeleted.document.relative_path).toBe(collidePath);

    // Folder move + cycle guard
    await expect(store.moveFolder(`${root}/sub`, `${root}/sub/leaf/bad`)).rejects.toBeInstanceOf(
      FolderValidationError,
    );
    const folderMove = await store.moveFolder(`${root}/sub`, `${root}/moved-sub`, "test");
    expect(folderMove.moved_folders).toBe(2);
    expect(folderMove.moved_documents).toBe(1);
    expect((await store.getDocument(docBId))?.relative_path).toBe(`wiki/${root}/moved-sub/b.md`);

    // Folder delete modes
    await expect(store.deleteFolder(`${root}/moved-sub`, "empty")).rejects.toBeInstanceOf(FolderConflictError);
    await store.deleteFolder(`${root}/moved-sub/leaf`, "empty");
    const moveParentDel = await store.deleteFolder(`${root}/moved-sub`, "move_to_parent", "", "test");
    expect(moveParentDel.moved_documents).toBe(1);
    expect((await store.getDocument(docBId))?.relative_path).toBe(`wiki/${root}/b.md`);

    const cascadeDel = await store.deleteFolder(`${root}/new`, "cascade", "", "test");
    expect(cascadeDel.deleted_documents).toBe(1);
    expect(await store.getDocument(docAId)).not.toBeNull();
    expect((await store.getDocument(docAId))?.deleted_at).not.toBe("");

    // System page protection
    const ovId = randomUUID();
    await pool.query(
      `INSERT INTO documents (id, user_id, filename, title, path, relative_path, source_kind, file_type, status, content, page_type)
       VALUES ($1, 'default', 'overview.md', 'Overview', '/wiki/', 'wiki/overview.md', 'wiki', 'md', 'ready', '# Overview', 'page')
       ON CONFLICT (relative_path) DO NOTHING`,
      [ovId],
    );
    const ovDoc = await store.getDocumentByRelativePath("wiki/overview.md");
    if (ovDoc) {
      await expect(store.moveDocument(ovDoc.id, `${root}`)).rejects.toBeInstanceOf(FolderValidationError);
      if (ovDoc.id === ovId) await pool.query("DELETE FROM documents WHERE id = $1", [ovId]);
    }
  });

  it("supports migration v5 metadata, in-place archive/reopen isolation, and symptom/alias search", async () => {
    const { buildArchivedDocument, buildReopenedDocument } = await import("../../engine/archive.js");
    const root = `v5-${suffix}`;
    const pitfallId = randomUUID();
    const pitfallPath = `wiki/${root}/pg-pool.md`;
    const pitfallContent = [
      "---",
      "title: PG 连接池耗尽",
      "type: experience",
      "kind: pitfall",
      "status: validated",
      "confidence: high",
      "date: 2026-11-20",
      "last_verified: 2026-11-20",
      "review_after: 2026-11-22",
      "aliases: [pg-pool-exhausted]",
      "symptoms: [too many clients already]",
      "sources: [incident.md]",
      "---",
      "",
      "# 适用场景",
      "",
      "高并发连接池配置。",
    ].join("\n");

    await store.applyChangeSet(
      { id: "", kind: "manual", summary: "create pitfall", page_count: 1, created_at: "" },
      [
        {
          relative_path: pitfallPath,
          document: {
            id: pitfallId,
            user_id: "default",
            filename: "pg-pool.md",
            title: "PG 连接池耗尽",
            path: `/wiki/${root}/`,
            relative_path: pitfallPath,
            source_kind: "wiki",
            file_type: "md",
            file_size: pitfallContent.length,
            document_number: 0,
            status: "ready",
            page_count: 1,
            content: pitfallContent,
            tags: [],
            date: "2026-11-20",
            metadata: "{}",
            error_message: "",
            version: 0,
            parser: "",
            content_hash: "hp1",
            stale_since: "",
            highlights: "[]",
            created_at: "",
            updated_at: "",
            page_type: "experience",
          },
          operation: "create",
          chunks: [],
          refs: [],
        },
      ],
    );

    const created = await store.getDocument(pitfallId);
    expect(created?.page_type).toBe("experience");
    expect(created?.experience_kind).toBe("pitfall");
    expect(created?.page_status).toBe("validated");
    expect(created?.confidence).toBe("high");
    expect(created?.symptoms).toEqual(["too many clients already"]);
    expect(created?.aliases).toEqual(["pg-pool-exhausted"]);

    // Search by symptom and alias
    const bySymptom = await store.searchChunks("too many clients", 10, "wiki", {
      page_types: ["experience"],
      experience_kinds: ["pitfall"],
    });
    expect(bySymptom.some((hit) => hit.document_id === pitfallId)).toBe(true);

    const byAlias = await store.searchChunks("pg-pool-exhausted", 10, "wiki");
    expect(byAlias.some((hit) => hit.document_id === pitfallId)).toBe(true);

    const overdue = await store.listDocumentsFiltered({
      source_kind: "wiki",
      review_overdue: true,
      today: "2026-11-25",
    });
    expect(overdue.some((doc) => doc.id === pitfallId)).toBe(true);

    // In-place archive isolates from default list & search, but keeps getDocument readable
    const archivedDoc = buildArchivedDocument(created!, {
      reason: "已升级为自动池化",
      supersededBy: "[[auto-pool]]",
      date: "2026-11-25",
    });
    await store.applyChangeSet(
      { id: "", kind: "manual", summary: "archive pitfall", page_count: 1, created_at: "" },
      [{ relative_path: pitfallPath, document: archivedDoc, operation: "archive", chunks: [], refs: [] }],
    );

    expect((await store.listDocumentsFiltered({ source_kind: "wiki" })).some((d) => d.id === pitfallId)).toBe(false);
    expect(
      (await store.listDocumentsFiltered({ source_kind: "wiki", archived: "only" })).some((d) => d.id === pitfallId),
    ).toBe(true);
    expect((await store.searchChunks("too many clients", 10, "wiki")).some((h) => h.document_id === pitfallId)).toBe(
      false,
    );
    expect((await store.getDocument(pitfallId))?.archived_at).toBe("2026-11-25");

    // Reopen restores visibility and records revision
    const loadedArchived = (await store.getDocument(pitfallId))!;
    const reopenedDoc = buildReopenedDocument(loadedArchived, {
      reason: "需要重新核实",
      confidence: "medium",
      lastVerified: "2026-11-25",
      date: "2026-11-25",
    });
    await store.applyChangeSet(
      { id: "", kind: "manual", summary: "reopen pitfall", page_count: 1, created_at: "" },
      [{ relative_path: pitfallPath, document: reopenedDoc, operation: "reopen", chunks: [], refs: [] }],
    );
    expect((await store.listDocumentsFiltered({ source_kind: "wiki" })).some((d) => d.id === pitfallId)).toBe(true);
    const revs = await store.listPageRevisions(pitfallPath, 10);
    expect(revs.map((r) => r.operation)).toContain("archive");
    expect(revs.map((r) => r.operation)).toContain("reopen");

    await pool.query("DELETE FROM documents WHERE relative_path LIKE $1", [`wiki/${root}%`]);
    await pool.query("DELETE FROM wiki_folders WHERE path LIKE $1", [`${root}%`]);
  });
});
