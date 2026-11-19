import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore, type PartialStore } from "./db.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("postgres store integration", () => {
  let pool: Pool;
  let store: PartialStore;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    store = await openStore(pool);
    await pool.query("DELETE FROM workspace");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM documents WHERE relative_path LIKE $1", [`integration-${suffix}%`]);
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
});
