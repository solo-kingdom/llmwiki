import { describe, expect, it, vi } from "vitest";
import type { Client } from "./client.js";
import { runToolLoop } from "./tools.js";
import type { ChatResult, Message, ToolDefinition, ToolExecutor } from "./types.js";

const tools: ToolDefinition[] = [
  { name: "search", description: "search", parameters: { type: "object", properties: {} } },
  { name: "read", description: "read", parameters: { type: "object", properties: {} } },
];

describe("runToolLoop", () => {
  it("deduplicates identical tool calls and records per-round tool events", async () => {
    let turn = 0;
    const client = {
      chat: vi.fn(async (): Promise<ChatResult> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: "",
            reasoningContent: "",
            toolCalls: [{ id: "c1", name: "search", arguments: '{"query":"hela","mode":"search"}' }],
          };
        }
        if (turn === 2) {
          // Same args with different key order -> should be deduplicated
          return {
            content: "",
            reasoningContent: "",
            toolCalls: [{ id: "c2", name: "search", arguments: '{"mode":"search","query":"hela"}' }],
          };
        }
        return { content: '{"pages":[]}', reasoningContent: "", toolCalls: [] };
      }),
    } as unknown as Client;

    const executor: ToolExecutor = {
      listTools: async () => tools,
      execute: vi.fn(async () => "Found 1 result"),
    };
    const events: Array<{ step: string; phase: string; message: string; payload: Record<string, unknown> | null }> = [];
    const recorder = {
      record(step: string, phase: string, message: string, payload: Record<string, unknown> | null) {
        events.push({ step, phase, message, payload });
      },
    };

    const out = await runToolLoop(
      client,
      executor,
      [{ role: "user", content: "analyze" }],
      tools,
      0.1,
      4096,
      { maxRounds: 5, maxToolCallsPerRound: 4 },
      { step: "analysis", recorder },
    );

    expect(out).toBe('{"pages":[]}');
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(2);
    expect(events[0]?.phase).toBe("tool_round");
    const secondCalls = events[1]?.payload?.calls as Array<Record<string, unknown>>;
    expect(secondCalls[0]?.deduped).toBe(true);
  });

  it("forces one tool-free synthesis turn when maxRounds is exhausted after gathering tool context", async () => {
    const callsSeen: Array<{ hasTools: boolean; lastMessage: string }> = [];
    const client = {
      chat: vi.fn(async (messages: Message[], offeredTools: ToolDefinition[] | null): Promise<ChatResult> => {
        callsSeen.push({
          hasTools: Boolean(offeredTools && offeredTools.length > 0),
          lastMessage: messages[messages.length - 1]?.content ?? "",
        });
        if (offeredTools && offeredTools.length > 0) {
          return {
            content: "",
            reasoningContent: "",
            toolCalls: [{ id: `c-${callsSeen.length}`, name: "search", arguments: JSON.stringify({ query: `q${callsSeen.length}` }) }],
          };
        }
        return { content: '{"summary":"converged","pages":[]}', reasoningContent: "", toolCalls: [] };
      }),
    } as unknown as Client;

    const executor: ToolExecutor = {
      listTools: async () => tools,
      execute: vi.fn(async (_name, args) => `result for ${args}`),
    };

    const out = await runToolLoop(
      client,
      executor,
      [{ role: "user", content: "analyze" }],
      tools,
      0.1,
      4096,
      { maxRounds: 2, maxToolCallsPerRound: 4 },
      { step: "analysis" },
    );

    expect(out).toBe('{"summary":"converged","pages":[]}');
    expect(callsSeen).toHaveLength(3);
    expect(callsSeen[0]?.hasTools).toBe(true);
    expect(callsSeen[1]?.hasTools).toBe(true);
    expect(callsSeen[2]?.hasTools).toBe(false);
    expect(callsSeen[2]?.lastMessage).toContain("工具调用轮次已达上限");
  });

  it("throws when final synthesis is disabled or returns empty content", async () => {
    const client = {
      chat: vi.fn(async (_messages: Message[], offeredTools: ToolDefinition[] | null): Promise<ChatResult> => {
        if (offeredTools && offeredTools.length > 0) {
          return {
            content: "",
            reasoningContent: "",
            toolCalls: [{ id: "c1", name: "search", arguments: '{"query":"x"}' }],
          };
        }
        return { content: "   ", reasoningContent: "", toolCalls: [] };
      }),
    } as unknown as Client;

    const executor: ToolExecutor = {
      listTools: async () => tools,
      execute: vi.fn(async () => "ok"),
    };

    await expect(
      runToolLoop(
        client,
        executor,
        [{ role: "user", content: "analyze" }],
        tools,
        0.1,
        4096,
        { maxRounds: 1, maxToolCallsPerRound: 4 },
      ),
    ).rejects.toThrow("tool loop exceeded max rounds (1)");
  });
});
