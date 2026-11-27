import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document, WikiFolderWithCounts } from "../store/types.js";
import {
  refreshFolderOverviews,
  renderFolderOverview,
  renderRootOverview,
} from "./folder_overview.js";

function doc(relPath: string, pageType: string, title: string): Document {
  return {
    id: `id-${relPath}`,
    user_id: "default",
    filename: relPath.split("/").pop()!,
    title,
    path: `/${relPath.split("/").slice(0, -1).join("/")}/`,
    relative_path: relPath,
    source_kind: "wiki",
    file_type: "md",
    file_size: 100,
    document_number: 1,
    status: "ready",
    page_count: 0,
    content: `---\ntitle: ${title}\ntype: ${pageType}\n---\n# ${title}\n`,
    tags: [],
    date: "2026-11-27",
    metadata: "{}",
    error_message: "",
    version: 1,
    parser: "",
    content_hash: "h",
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: pageType,
  };
}

describe("folder_overview", () => {
  it("preserves manual notes outside AUTO_OVERVIEW markers", () => {
    const folder: WikiFolderWithCounts = {
      path: "system-network/proxy-dns",
      display_name: "代理与 DNS",
      description: "代理与 DNS 解析",
      sort_order: 1,
      doc_count: 1,
      subfolders: [],
      created_at: "",
      updated_at: "",
    };
    const existing = [
      "---",
      "title: 代理与 DNS 概览",
      "type: page",
      "---",
      "",
      "# 代理与 DNS",
      "",
      "人工补充说明：优先看 DNS 页面。",
      "",
      "<!-- AUTO_OVERVIEW_START -->",
      "旧内容",
      "<!-- AUTO_OVERVIEW_END -->",
      "",
    ].join("\n");

    const rendered = renderFolderOverview(
      folder,
      [],
      [doc("wiki/system-network/proxy-dns/dns.md", "concept", "DNS 解析")],
      existing,
    );
    expect(rendered).toContain("人工补充说明：优先看 DNS 页面。");
    expect(rendered).not.toContain("旧内容");
    expect(rendered).toContain("[[wiki/system-network/proxy-dns/dns.md|DNS 解析]]");
  });

  it("renders root overview and refreshes affected folders via applyChangeSet", async () => {
    const folders: WikiFolderWithCounts[] = [
      {
        path: "system-network",
        display_name: "系统与网络",
        description: "网络与基础设施",
        sort_order: 1,
        doc_count: 1,
        subfolders: [],
        created_at: "",
        updated_at: "",
      },
    ];
    const root = renderRootOverview(folders, [doc("wiki/system-network/dns.md", "concept", "DNS")]);
    expect(root).toContain("[[wiki/system-network/_overview.md|系统与网络]]");

    const applyChangeSet = vi.fn(async () => undefined);
    const db = {
      listFolders: async () => folders,
      listDocumentsWithContent: async () => [doc("wiki/system-network/dns.md", "concept", "DNS")],
      getDocumentByRelativePath: async () => null,
      applyChangeSet,
    } as unknown as Store;

    const written = await refreshFolderOverviews(db, ["system-network"]);
    expect(written).toContain("wiki/system-network/_overview.md");
    expect(written).toContain("wiki/overview.md");
    expect(applyChangeSet).toHaveBeenCalledTimes(1);
  });
});
