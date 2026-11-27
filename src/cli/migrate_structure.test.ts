import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import {
  applyStructureMigration,
  dryRunStructureMigration,
  parseStructureMigrationDocument,
  parseStructureMigrationManifest,
} from "./migrate_structure.js";

function doc(patch: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    user_id: "default",
    filename: "DNS多源解析抽奖.md",
    title: "DNS多源解析抽奖",
    path: "/wiki/concepts/网络代理/",
    relative_path: "wiki/concepts/网络代理/DNS多源解析抽奖.md",
    source_kind: "wiki",
    file_type: "md",
    file_size: 0,
    document_number: 1,
    status: "ready",
    page_count: 0,
    content: "body",
    tags: [],
    date: "",
    metadata: "{}",
    error_message: "",
    version: 1,
    parser: "",
    content_hash: "hash-1",
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: "concept",
    ...patch,
  };
}

function store(docs: Document[]) {
  return {
    listDocumentsWithContent: vi.fn(async () => docs),
    applyChangeSet: vi.fn(),
    moveDocument: vi.fn(),
  } as unknown as Store;
}

const move = {
  batch: "network-pilot",
  document_id: "doc-1",
  old_path: "wiki/concepts/网络代理/DNS多源解析抽奖.md",
  new_path: "wiki/系统与网络/代理与DNS/DNS多源解析.md",
  old_type: "concept",
  new_type: "concept",
  action: "move",
  rationale: "DNS 解析与代理故障主题",
  confidence: "high",
  status: "pending",
  content_hash: "hash-1",
};

describe("structure migration dry-run", () => {
  it("validates a move without calling any write API", async () => {
    const db = store([doc()]);
    const report = await dryRunStructureMigration(db, parseStructureMigrationManifest(JSON.stringify([move])));
    expect(report.valid).toBe(true);
    expect(report.stats).toMatchObject({ entries: 1, move: 1, retype: 0, merge: 0 });
    expect(db.applyChangeSet).not.toHaveBeenCalled();
    expect(db.moveDocument).not.toHaveBeenCalled();
  });

  it("reports source identity, type, hash and target conflicts together", async () => {
    const target = doc({
      id: "doc-2",
      relative_path: "wiki/系统与网络/代理与DNS/DNS多源解析.md",
      filename: "DNS多源解析.md",
      path: "/wiki/系统与网络/代理与DNS/",
    });
    const db = store([doc(), target]);
    const manifest = parseStructureMigrationManifest(JSON.stringify([{
      ...move,
      document_id: "wrong",
      old_type: "experience",
      content_hash: "stale",
    }]));
    const report = await dryRunStructureMigration(db, manifest);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "source_mismatch",
      "type_mismatch",
      "content_hash_mismatch",
      "target_conflict",
    ]));
  });

  it("requires an existing merge target and pending status", async () => {
    const db = store([doc()]);
    const report = await dryRunStructureMigration(db, parseStructureMigrationManifest(JSON.stringify([{
      ...move,
      action: "merge",
      merge_into_document_id: "missing",
      status: "applied",
    }])));
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "merge_target_missing",
      "entry_not_pending",
    ]));
  });

  it("applies folders, move, retype, merge (preserving archive links), and writes reverse manifest", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-mig-"));
    try {
      const reverseOut = path.join(tmpDir, "reverse.json");
      const docs = new Map<string, Document>([
        ["doc-1", doc({ id: "doc-1", relative_path: "wiki/concepts/net/a.md", page_type: "concept", content: "---\ntitle: A\ntype: concept\n---\nBody A" })],
        ["doc-2", doc({ id: "doc-2", relative_path: "wiki/entities/b.md", page_type: "entity", content: "---\ntitle: B\ntype: entity\nsources:\n  - b.md\n---\nBody B" })],
        ["doc-3", doc({ id: "doc-3", relative_path: "wiki/system-network/proxy-dns/target.md", page_type: "experience", content: "---\ntitle: Target\ntype: experience\nsources:\n  - t.md\n---\nBody T" })],
      ]);
      const linked: Array<{ docId: string; archiveId: string }> = [];
      const db = {
        listDocumentsWithContent: vi.fn(async () => Array.from(docs.values())),
        getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
        getFolder: vi.fn(async () => null),
        createFolder: vi.fn(async (f) => f),
        moveDocument: vi.fn(async (id: string, folder: string, filename: string) => {
          const d = docs.get(id)!;
          d.relative_path = `wiki/${folder}/${filename}`;
          d.filename = filename;
          d.path = `/wiki/${folder}/`;
          return { document: d, old_relative_path: "", change_set_id: "cs-move", updated_link_paths: [] };
        }),
        applyChangeSet: vi.fn(async (_cs, writes) => {
          for (const w of writes) {
            if (w.operation === "update" && w.document) {
              docs.set(w.document.id, w.document);
            } else if (w.operation === "delete") {
              for (const [k, v] of docs) {
                if (v.relative_path === w.relative_path) docs.delete(k);
              }
            }
          }
        }),
        listDocumentArchiveSources: vi.fn(async (id: string) => (id === "doc-2" ? [{ id: "arch-2" }] : [])),
        linkDocumentArchiveSource: vi.fn(async (docId: string, archiveId: string) => {
          linked.push({ docId, archiveId });
        }),
      } as unknown as Store;

      const manifest = parseStructureMigrationDocument(JSON.stringify({
        folders: [{ path: "system-network/proxy-dns", display_name: "代理与 DNS" }],
        entries: [
          {
            batch: "b1",
            document_id: "doc-1",
            old_path: "wiki/concepts/net/a.md",
            new_path: "wiki/system-network/proxy-dns/a.md",
            old_type: "concept",
            new_type: "experience",
            action: "retype",
            rationale: "is experience",
            confidence: "high",
            status: "pending",
          },
          {
            batch: "b1",
            document_id: "doc-2",
            old_path: "wiki/entities/b.md",
            new_path: "wiki/system-network/proxy-dns/target.md",
            old_type: "entity",
            new_type: "experience",
            action: "merge",
            merge_into_document_id: "doc-3",
            rationale: "duplicate",
            confidence: "high",
            status: "pending",
          },
        ],
      }));

      const res = await applyStructureMigration(db, manifest, { reverseOut });
      expect(res.applied).toBe(2);
      expect(res.folders_ensured).toBe(1);
      expect(res.moved).toBe(1);
      expect(res.retyped).toBe(1);
      expect(res.merged).toBe(1);
      expect(linked).toEqual([{ docId: "doc-3", archiveId: "arch-2" }]);
      expect(docs.has("doc-2")).toBe(false);
      expect(docs.get("doc-3")?.content).toContain("Body B");
      const reverseRaw = JSON.parse(await readFile(reverseOut, "utf8"));
      expect(reverseRaw.entries).toHaveLength(1);
      expect(reverseRaw.entries[0].old_path).toBe("wiki/system-network/proxy-dns/a.md");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
