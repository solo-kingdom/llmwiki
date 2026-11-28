import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document, SearchChunk } from "../store/types.js";
import {
  executeLocalRead,
  executeLocalSearch,
  formatSearchResultPath,
  resolveDocumentByIdOrPath,
} from "./local_tools.js";

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-senv-001",
    filename: "senv-environment-sync.md",
    title: "senv",
    path: "/wiki/engineering-delivery/senv-sync/",
    relative_path: "wiki/engineering-delivery/senv-sync/senv-environment-sync.md",
    source_kind: "wiki",
    file_type: "md",
    status: "indexed",
    version: 3,
    content: "# senv\n\nCLI facts.",
    tags: ["senv"],
    page_type: "entity",
    confidence: "high",
    page_status: "",
    experience_kind: "",
    archived_at: "",
    ...overrides,
  } as Document;
}

describe("local_tools search & read contract", () => {
  it("formats search result path by joining dirPath and filename without duplicates", () => {
    expect(formatSearchResultPath("/wiki/ai-agent/agent-runtime/", "hela-agent-runtime.md")).toBe(
      "wiki/ai-agent/agent-runtime/hela-agent-runtime.md",
    );
    expect(formatSearchResultPath("wiki/ai-agent/agent-runtime/hela-agent-runtime.md", "hela-agent-runtime.md")).toBe(
      "wiki/ai-agent/agent-runtime/hela-agent-runtime.md",
    );
  });

  it("resolves read by relative_path (with or without leading slash or wiki/ prefix) and outputs Document ID", async () => {
    const doc = makeDoc();
    const db = {
      getDocument: vi.fn(async (id: string) => (id === doc.id ? doc : null)),
      getDocumentByRelativePath: vi.fn(async (rel: string) => (rel === doc.relative_path ? doc : null)),
      findDocumentByName: vi.fn(async () => null),
    } as unknown as Store;

    expect((await resolveDocumentByIdOrPath(db, doc.relative_path))?.id).toBe(doc.id);
    expect((await resolveDocumentByIdOrPath(db, `/${doc.relative_path}`))?.id).toBe(doc.id);
    expect((await resolveDocumentByIdOrPath(db, "engineering-delivery/senv-sync/senv-environment-sync.md"))?.id).toBe(
      doc.id,
    );

    const out = await executeLocalRead(db, { path: doc.relative_path });
    expect(out).toContain(`Document ID: ${doc.id}`);
    expect(out).toContain(`Path: ${doc.relative_path}`);
    expect(out).toContain("# senv");
  });

  it("includes full relative_path and document_id in search output and truncates huge chunks", async () => {
    const longBody = "A".repeat(2000);
    const chunk: SearchChunk = {
      document_id: "26438bfa-e483-4e63-96a2-8f04956b918d",
      filename: "hela-agent-runtime.md",
      title: "hela",
      path: "/wiki/ai-agent/agent-runtime/",
      file_type: "md",
      page: 1,
      header_breadcrumb: "概述",
      chunk_index: 0,
      content: longBody,
      score: 2.15,
      page_type: "entity",
      confidence: "high",
      page_status: "",
      experience_kind: "",
      last_verified: "",
      review_after: "",
      archived_at: "",
      symptoms: [],
    };
    const db = {
      searchChunks: vi.fn(async () => [chunk]),
    } as unknown as Store;

    const out = await executeLocalSearch("", db, { mode: "search", query: "hela" });
    expect(out).toContain("`wiki/ai-agent/agent-runtime/hela-agent-runtime.md`");
    expect(out).toContain("id: `26438bfa-e483-4e63-96a2-8f04956b918d`");
    expect(out).toContain("truncated, use read for full content");
    expect(out.length).toBeLessThan(1800);
  });

  it("filters list mode by path prefix, applies limit, and prints document_id", async () => {
    const docs = [
      makeDoc({ id: "id-1", relative_path: "wiki/engineering-delivery/senv-sync/a.md", title: "A" }),
      makeDoc({ id: "id-2", relative_path: "wiki/engineering-delivery/senv-sync/b.md", title: "B" }),
      makeDoc({ id: "id-3", relative_path: "wiki/system-network/hosts-devices/lnv.md", title: "lnv" }),
    ];
    const db = {
      listDocumentsFiltered: vi.fn(async () => docs),
    } as unknown as Store;

    const out = await executeLocalSearch("", db, {
      mode: "list",
      path: "wiki/engineering-delivery/senv-sync/",
      limit: 1,
    });
    expect(out).toContain("Found 2 documents (showing first 1");
    expect(out).toContain("id: `id-1`");
    expect(out).not.toContain("id-2");
    expect(out).not.toContain("id-3");
  });
});
