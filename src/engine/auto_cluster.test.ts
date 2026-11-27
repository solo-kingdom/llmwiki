import { describe, expect, it } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document, WikiFolderWithCounts } from "../store/types.js";
import { buildDeterministicClusterPlan, detectOvercrowdedFolders } from "./auto_cluster.js";

function doc(id: string, relPath: string, tags: string[]): Document {
  return {
    id,
    user_id: "default",
    filename: relPath.split("/").pop()!,
    title: id,
    path: `/${relPath.split("/").slice(0, -1).join("/")}/`,
    relative_path: relPath,
    source_kind: "wiki",
    file_type: "md",
    file_size: 100,
    document_number: 1,
    status: "ready",
    page_count: 0,
    content: "body",
    tags,
    date: "",
    metadata: "{}",
    error_message: "",
    version: 1,
    parser: "",
    content_hash: `hash-${id}`,
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: "experience",
  };
}

describe("auto_cluster", () => {
  it("detects overcrowded wiki folders above threshold", async () => {
    const db = {
      listFolders: async () => [
        { path: "system-network/proxy-dns", direct_count: 25, doc_count: 25, display_name: "代理与 DNS" },
        { path: "products/llmwiki", direct_count: 5, doc_count: 5, display_name: "llmwiki" },
      ] as unknown as WikiFolderWithCounts[],
      listArchiveFolders: async () => [],
    } as unknown as Store;

    const hits = await detectOvercrowdedFolders(db, { wikiThreshold: 20 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("system-network/proxy-dns");
  });

  it("clusters documents by shared tags and emits kebab-case subfolder entries", () => {
    const docs = [
      doc("1", "wiki/system-network/proxy-dns/a.md", ["clash", "dns"]),
      doc("2", "wiki/system-network/proxy-dns/b.md", ["clash", "tun"]),
      doc("3", "wiki/system-network/proxy-dns/c.md", ["clash", "rules"]),
      doc("4", "wiki/system-network/proxy-dns/d.md", ["wireguard"]),
    ];
    const plan = buildDeterministicClusterPlan(docs, "system-network/proxy-dns", { minClusterSize: 3 });
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0]?.path).toBe("system-network/proxy-dns/clash");
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries.every((e) => e.new_path.startsWith("wiki/system-network/proxy-dns/clash/"))).toBe(true);
  });
});
