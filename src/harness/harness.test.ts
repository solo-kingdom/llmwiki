import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import type { IngestSession } from "../store/types.js";
import { HarnessManager, resolveSessionRuntime, type EventSink } from "./index.js";

function startServer(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => handler(req, Buffer.concat(chunks).toString("utf8"), res));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected TCP address");
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function makeStore(initial: Record<string, string> = {}, providerUrl = "http://127.0.0.1:9999/v1") {
  const config = new Map<string, string>(Object.entries(initial));
  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    listDocumentsFiltered: vi.fn().mockResolvedValue([]),
    listDocuments: vi.fn().mockResolvedValue([]),
    listFolders: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn().mockResolvedValue(null),
    trimActivityLogs: vi.fn().mockResolvedValue(0),
    trimAllIngestJobEvents: vi.fn().mockResolvedValue(undefined),
    getProviderInstance: vi.fn(async (id: string) =>
      id === "inst_1"
        ? {
            id: "inst_1",
            name: "Local Mock",
            catalog_id: "custom",
            api_format: "openai",
            base_url: providerUrl,
            api_key: "sk-mock",
            models: ["gpt-test"],
            enabled: true,
            created_at: "",
            updated_at: "",
          }
        : null,
    ),
    getProviderInfo: vi.fn().mockResolvedValue(null),
    searchChunks: vi.fn().mockResolvedValue([]),
    upsertSessionReference: vi.fn().mockResolvedValue(undefined),
  } as unknown as Store;
  return { store, config };
}

function makeApp(store: Store, workspace = "") {
  return createApp({
    db: store,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace,
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

const MOCK_ACP_SCRIPT = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'mock-acp', version: '0.1.0' } } });
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'remote_1' } });
  } else if (msg.method === 'session/prompt') {
    const sid = msg.params.sessionId;
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking...' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'plan', entries: [{ content: 'Read wiki', status: 'in_progress' }] } } });
    send({ jsonrpc: '2.0', id: 77, method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 'tc_1', title: 'Write file', kind: 'edit' }, options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }] } });
    const onReply = (replyLine) => {
      const reply = JSON.parse(replyLine);
      if (reply.id === 77) {
        rl.off('line', onReply);
        const allowed = reply.result?.outcome?.optionId === 'allow_once';
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? 'written' : 'readonly-ok' } } } });
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
      }
    };
    rl.on('line', onReply);
  }
});
`;

describe("llmwiki harnix integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it("exposes harness descriptors and supports three-kind settings with security validation", async () => {
    const { store } = makeStore();
    const app = makeApp(store);

    const descRes = await app.request("/api/v1/harness/descriptors");
    expect(descRes.status).toBe(200);
    const descBody = (await descRes.json()) as { descriptors: Array<{ id: string }> };
    expect(descBody.descriptors.map((d) => d.id)).toEqual(["native", "pi", "acp"]);

    const putOk = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        harnix_settings: {
          version: 1,
          defaultKind: "pi",
          pi: { reasoning: true, contextWindow: 65536 },
        },
      }),
    });
    expect(putOk.status).toBe(200);
    const putBody = (await putOk.json()) as {
      default_agent_kind: string;
      harnix_settings: { defaultKind: string; pi: { reasoning: boolean; contextWindow: number } };
    };
    expect(putBody.default_agent_kind).toBe("pi");
    expect(putBody.harnix_settings.pi.reasoning).toBe(true);
    expect(putBody.harnix_settings.pi.contextWindow).toBe(65536);

    // Reject ACP security violation (plain env object)
    const putBad = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        harnix_settings: {
          acp: {
            agents: {
              bad: { id: "bad", name: "Bad", command: "claude", env: { KEY: "secret" } },
            },
          },
        },
      }),
    });
    expect(putBad.status).toBe(400);
  });

  it("probes native, pi, and acp harnesses via /api/v1/harness/check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-acp-probe-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const agentFile = path.join(dir, "mock-acp.mjs");
    await fs.writeFile(agentFile, MOCK_ACP_SCRIPT, "utf8");

    const { store } = makeStore({
      last_instance_id: "inst_1",
      last_model: "gpt-test",
    });
    const app = makeApp(store, dir);

    const nativeCheck = await app.request("/api/v1/harness/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "native" }),
    });
    expect(nativeCheck.status).toBe(200);
    expect(((await nativeCheck.json()) as { ok: boolean }).ok).toBe(true);

    const acpCheck = await app.request("/api/v1/harness/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "acp",
        harnix_settings: {
          acp: {
            defaultAgentId: "mock",
            agents: {
              mock: {
                id: "mock",
                name: "Mock ACP",
                enabled: true,
                command: process.execPath,
                args: [agentFile],
              },
            },
          },
        },
      }),
    });
    expect(acpCheck.status).toBe(200);
    const acpBody = (await acpCheck.json()) as { ok: boolean; details: Array<{ agentName?: string }> };
    expect(acpBody.ok).toBe(true);
    expect(acpBody.details[0]?.agentName).toBe("mock-acp");
  });

  it("runs native, pi, and acp sessions through HarnixChatRuntime", async () => {
    const srv = await startServer((_req, _body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "gpt-test",
          choices: [{ index: 0, delta: { role: "assistant", content: "hello from sse" }, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    cleanups.push(srv.close);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-runtime-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const agentFile = path.join(dir, "mock-acp.mjs");
    await fs.writeFile(agentFile, MOCK_ACP_SCRIPT, "utf8");

    const { store } = makeStore(
      {
        last_instance_id: "inst_1",
        last_model: "gpt-test",
        harnix_settings_json: JSON.stringify({
          version: 1,
          defaultKind: "native",
          acp: {
            defaultAgentId: "mock",
            maxConcurrentSessions: 1,
            defaults: { readonlyOnly: true, onUnavailable: "error" },
            agents: {
              mock: {
                id: "mock",
                name: "Mock ACP",
                enabled: true,
                command: process.execPath,
                args: [agentFile],
              },
            },
          },
        }),
      },
      srv.url,
    );

    const mgr = new HarnessManager();
    cleanups.push(() => mgr.closeAll());

    const makeSink = () => {
      const tokens: string[] = [];
      const thoughts: string[] = [];
      const sink: EventSink = {
        token: (t) => tokens.push(t),
        thought: (t) => thoughts.push(t),
        toolStart: () => undefined,
        toolDone: () => undefined,
        plan: () => undefined,
        permission: () => undefined,
        warning: () => undefined,
        debug: () => undefined,
      };
      return { sink, tokens, thoughts };
    };

    for (const kind of ["native", "pi"] as const) {
      const session: IngestSession = {
        id: `s_${kind}`,
        title: kind,
        status: "active",
        storage_path: "",
        llm_instance_id: "inst_1",
        llm_model: "gpt-test",
        mode: "qa",
        agent_kind: kind,
        acp_agent_id: "",
        created_at: "",
        updated_at: "",
      };
      const rt = await resolveSessionRuntime(store, dir, mgr, session);
      const { sink, tokens } = makeSink();
      const res = await rt.prompt(
        {
          sessionId: session.id,
          mode: "qa",
          docLang: "zh",
          userContent: "hi",
          displayUserContent: "hi",
          history: [],
          wikiRefs: [],
          recorder: null,
        },
        sink,
      );
      expect(res.text).toBe("hello from sse");
      expect(tokens.join("")).toBe("hello from sse");
    }

    const acpSession: IngestSession = {
      id: "s_acp",
      title: "acp",
      status: "active",
      storage_path: "",
      llm_instance_id: "",
      llm_model: "",
      mode: "qa",
      agent_kind: "acp",
      acp_agent_id: "mock",
      created_at: "",
      updated_at: "",
    };
    const acpRt = await resolveSessionRuntime(store, dir, mgr, acpSession);
    const { sink: acpSink, thoughts } = makeSink();
    const acpRes = await acpRt.prompt(
      {
        sessionId: acpSession.id,
        mode: "qa",
        docLang: "zh",
        userContent: "try write",
        displayUserContent: "try write",
        history: [],
        wikiRefs: [],
        recorder: null,
      },
      acpSink,
    );
    expect(acpRes.text).toBe("readonly-ok");
    expect(thoughts.join("")).toBe("thinking...");
    await mgr.closeSession(acpSession.id);
  });
});
