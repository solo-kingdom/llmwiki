import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import {
  dryRunStructureMigration,
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
});
