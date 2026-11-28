import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { defaultToolPolicy } from "./policy.js";
import { McpServer } from "./server.js";
import { registerTools } from "./tools.js";

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    user_id: "default",
    filename: "agent.md",
    title: "Agent",
    path: "/wiki/AI/Agent/",
    relative_path: "wiki/AI/Agent/agent.md",
    source_kind: "wiki",
    file_type: "md",
    file_size: 100,
    document_number: 1,
    status: "ready",
    page_count: 1,
    content: [
      "---",
      "title: Agent",
      "type: concept",
      "date: 2026-11-28",
      "---",
      "",
      "# 概述",
      "第一行",
      "```bash",
      "# bash comment should not appear in outline",
      "echo ok",
      "```",
      "## 细节",
      "最后一行",
    ].join("\n"),
    tags: ["ai", "agent"],
    date: "2026-11-28",
    metadata: "",
    error_message: "",
    version: 2,
    parser: "",
    content_hash: "h1",
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeStore(docsList: Document[]) {
  const docs = new Map(docsList.map((d) => [d.id, d]));
  const applyChangeSet = vi.fn().mockResolvedValue(undefined);
  const archiveDocuments = vi.fn().mockResolvedValue(1);
  const replaceReferencesInTx = vi.fn().mockResolvedValue(undefined);
  const listFolders = vi.fn().mockResolvedValue([
    { path: "AI", display_name: "AI", description: "", sort_order: 0, created_at: "", updated_at: "", direct_count: 0, total_count: 1 },
    { path: "AI/Agent", display_name: "Agent", description: "", sort_order: 0, created_at: "", updated_at: "", direct_count: 1, total_count: 1 },
  ]);
  const moveDocument = vi.fn(async (id: string, targetFolder: string) => {
    const d = docs.get(id)!;
    const oldRel = d.relative_path;
    d.relative_path = `wiki/${targetFolder}/agent.md`;
    d.path = `/wiki/${targetFolder}/`;
    return {
      document: { ...d },
      old_relative_path: oldRel,
      change_set_id: "cs-move",
      updated_link_paths: ["wiki/AI/other.md"],
    };
  });
  const moveFolder = vi.fn(async (fromPath: string, toPath: string) => {
    for (const d of docs.values()) {
      if (d.relative_path.startsWith(`wiki/${fromPath}/`)) {
        d.relative_path = `wiki/${toPath}/${d.relative_path.slice(`wiki/${fromPath}/`.length)}`;
        d.path = `/wiki/${toPath}/`;
      }
    }
    return {
      from_path: fromPath,
      to_path: toPath,
      moved_folders: 1,
      moved_documents: 1,
      moved_doc_paths: [`wiki/${toPath}/agent.md`],
      change_set_id: "cs-fmove",
      updated_link_paths: ["wiki/AI/other.md"],
    };
  });

  const store = {
    getDocument: vi.fn(async (id: string) => docs.get(id) ?? null),
    getDocumentByRelativePath: vi.fn(async (rel: string) => {
      for (const d of docs.values()) {
        if (d.relative_path === rel) return d;
      }
      return null;
    }),
    findDocumentByName: vi.fn(async () => null),
    listDocumentsFiltered: vi.fn(async () => [...docs.values()]),
    listDocumentsWithContent: vi.fn(async () => [...docs.values()]),
    listReferenceEntries: vi.fn().mockResolvedValue([]),
    listFolders,
    applyChangeSet,
    archiveDocuments,
    replaceReferencesInTx,
    moveDocument,
    moveFolder,
    createActivityLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as Store;

  return { store, applyChangeSet, archiveDocuments, replaceReferencesInTx, moveDocument, moveFolder };
}

describe("MCP hardening & read alignment", () => {
  async function rpc(server: McpServer, method: string, params?: unknown) {
    return server.handleRequest({ jsonrpc: "2.0", id: 1, method, params });
  }

  it("enforces deny-by-default and blocks move/folder in readonly mode", async () => {
    const { store } = makeStore([makeDoc()]);
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.registerTool(
      { name: "unregistered_custom", description: "test", inputSchema: { type: "object", properties: {} } },
      async () => "should not run",
    );
    server.setToolPolicy(defaultToolPolicy(false));

    const listRes = await rpc(server, "tools/list");
    const names = ((listRes?.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(names).not.toContain("move");
    expect(names).not.toContain("folder");
    expect(names).not.toContain("unregistered_custom");

    const moveRes = await rpc(server, "tools/call", { name: "move", arguments: { id: "doc-1", target_folder: "New" } });
    expect(moveRes?.error?.message).toContain("disabled by policy");

    const folderRes = await rpc(server, "tools/call", { name: "folder", arguments: { action: "delete", path: "AI" } });
    expect(folderRes?.error?.message).toContain("disabled by policy");

    const unknownRes = await rpc(server, "tools/call", { name: "unregistered_custom", arguments: {} });
    expect(unknownRes?.error?.message).toContain("disabled by policy");
  });

  it("supports read line_start/line_end and outline_only", async () => {
    const { store } = makeStore([makeDoc()]);
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.setToolPolicy(defaultToolPolicy(false));

    const rangeRes = await rpc(server, "tools/call", {
      name: "read",
      arguments: { path: "wiki/AI/Agent/agent.md", line_start: 7, line_end: 8 },
    });
    const rangeText = (rangeRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(rangeText).toContain("Lines: 7-8 / 14");
    expect(rangeText).toContain("# 概述");
    expect(rangeText).toContain("第一行");
    expect(rangeText).not.toContain("## 细节");

    const outlineRes = await rpc(server, "tools/call", {
      name: "read",
      arguments: { path: "wiki/AI/Agent/agent.md", outline_only: true },
    });
    const outlineText = (outlineRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(outlineText).toContain("L7: # 概述");
    expect(outlineText).toContain("L13: ## 细节");
    expect(outlineText).not.toContain("bash comment");
  });

  it("routes MCP delete through applyChangeSet and protects system pages", async () => {
    const sysDoc = makeDoc({ id: "doc-sys", relative_path: "wiki/overview.md", filename: "overview.md" });
    const { store, applyChangeSet, archiveDocuments } = makeStore([makeDoc(), sysDoc]);
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.setToolPolicy(defaultToolPolicy(true));

    const sysDel = await rpc(server, "tools/call", { name: "delete", arguments: { path: "wiki/overview.md" } });
    const sysText = (sysDel?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(sysText).toContain("cannot delete protected system page");

    const delRes = await rpc(server, "tools/call", { name: "delete", arguments: { path: "wiki/AI/Agent/agent.md" } });
    const delText = (delRes?.result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(delText).toContain("Deleted document:");
    expect(applyChangeSet).toHaveBeenCalled();
    expect(archiveDocuments).not.toHaveBeenCalled();
  });

  it("rebuilds references and refreshes overviews on MCP move and folder move", async () => {
    const { store, replaceReferencesInTx, applyChangeSet } = makeStore([makeDoc()]);
    const server = new McpServer("LLM Wiki", "");
    registerTools(server, "", store);
    server.setToolPolicy(defaultToolPolicy(true));

    await rpc(server, "tools/call", { name: "move", arguments: { id: "doc-1", target_folder: "NewDir" } });
    expect(replaceReferencesInTx).toHaveBeenCalled();
    expect(applyChangeSet).toHaveBeenCalled();

    replaceReferencesInTx.mockClear();
    await rpc(server, "tools/call", { name: "folder", arguments: { action: "move", path: "AI/Agent", to_path: "NewDir" } });
    expect(replaceReferencesInTx).toHaveBeenCalled();
  });
});
