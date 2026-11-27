import { describe, expect, it } from "vitest";
import type { Document } from "../store/types.js";
import {
  canonicalKeysForDocument,
  findCanonicalPageConflict,
  normalizeCanonicalPageName,
} from "./canonical.js";

function doc(patch: Partial<Document>): Document {
  return {
    id: "d1",
    user_id: "default",
    filename: "MiniMax.md",
    title: "MiniMax",
    path: "/wiki/AI与Agent/模型与Provider/",
    relative_path: "wiki/AI与Agent/模型与Provider/MiniMax.md",
    source_kind: "wiki",
    file_type: "md",
    file_size: 0,
    document_number: 1,
    status: "ready",
    page_count: 0,
    content: "",
    tags: [],
    date: "",
    metadata: "{}",
    error_message: "",
    version: 0,
    parser: "",
    content_hash: "",
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    aliases: [],
    ...patch,
  };
}

describe("canonical page names", () => {
  it("normalizes Unicode, case, whitespace, underscores and hyphens", () => {
    expect(normalizeCanonicalPageName("  Ｍini Max_Provider-协议 ")).toBe("minimaxprovider协议");
  });

  it("collects title, filename and aliases but excludes hidden sources", () => {
    const keys = canonicalKeysForDocument(doc({
      filename: "MiniMax_Provider-协议.md",
      aliases: ["Mini Max", "minimax"],
    }));
    expect(keys).toContain("name:minimax");
    expect(keys).toContain("name:minimaxprovider协议");
    expect(new Set(keys).size).toBe(keys.length);
    expect(canonicalKeysForDocument(doc({
      relative_path: "wiki/sources/MiniMax.md",
      path: "/wiki/sources/",
    }))).toEqual([]);
  });

  it("finds conflicts across paths while permitting same-page updates", () => {
    const existing = doc({ aliases: ["Mini Max"] });
    const candidate = doc({
      id: "",
      filename: "mini_max.md",
      title: "MINI MAX",
      path: "/wiki/产品与项目/MiniMax/",
      relative_path: "wiki/产品与项目/MiniMax/mini_max.md",
    });
    expect(findCanonicalPageConflict(candidate, [existing])?.id).toBe("d1");
    expect(findCanonicalPageConflict(existing, [existing])).toBeNull();
  });
});
