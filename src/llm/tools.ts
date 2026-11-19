import type { Client } from "./client.js";
import type { ChatResult, Message, ToolCall, ToolDefinition, ToolExecutor, ToolLoopConfig } from "./types.js";

export function defaultToolLoopConfig(): ToolLoopConfig {
  return { maxRounds: 12, maxToolCallsPerRound: 4 };
}

export async function runToolLoop(
  client: Client | null,
  executor: ToolExecutor | null,
  messages: Message[],
  tools: ToolDefinition[],
  temperature: number,
  maxTokens: number,
  config: ToolLoopConfig = defaultToolLoopConfig(),
): Promise<string> {
  if (!client) throw new Error("LLM client is nil");
  const maxRounds = config.maxRounds > 0 ? config.maxRounds : defaultToolLoopConfig().maxRounds;
  const maxToolCallsPerRound =
    config.maxToolCallsPerRound > 0
      ? config.maxToolCallsPerRound
      : defaultToolLoopConfig().maxToolCallsPerRound;

  const working: Message[] = [...messages];
  const useTools = tools.length > 0 && executor !== null;

  for (let round = 0; round < maxRounds; round += 1) {
    const result: ChatResult = await client.chat(
      working,
      useTools ? tools : null,
      temperature,
      maxTokens,
    );
    if (result.toolCalls.length === 0) return result.content;
    if (!useTools) return result.content;

    let calls: ToolCall[] = result.toolCalls;
    if (calls.length > maxToolCallsPerRound) {
      calls = calls.slice(0, maxToolCallsPerRound);
    }

    working.push({
      role: "assistant",
      content: result.content,
      reasoning_content: result.reasoningContent,
      tool_calls: calls,
    });

    for (const call of calls) {
      let output: string;
      try {
        output = await executor.execute(call.name, call.arguments);
      } catch (error) {
        output = `tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      working.push({
        role: "tool",
        content: output,
        tool_call_id: call.id,
        name: call.name,
      });
    }
  }
  throw new Error(`tool loop exceeded max rounds (${maxRounds})`);
}
