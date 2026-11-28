import type { Client } from "./client.js";
import type { ChatResult, Message, ToolCall, ToolDefinition, ToolExecutor, ToolLoopConfig } from "./types.js";

export interface ToolLoopRecorder {
  record(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void;
}

export interface RunToolLoopOptions {
  step?: string;
  recorder?: ToolLoopRecorder | null;
  /**
   * When true (default), if maxRounds is exhausted while the model is still requesting
   * tools after already gathering tool outputs, issue one final tool-free chat turn so
   * the accumulated context is converted into a final response instead of discarded.
   */
  finalSynthesisOnExhaustion?: boolean;
}

export function defaultToolLoopConfig(): ToolLoopConfig {
  return { maxRounds: 12, maxToolCallsPerRound: 4 };
}

function normalizeCallKey(name: string, argsJson: string): string {
  const normalizedName = name.trim().toLowerCase();
  const trimmed = argsJson.trim();
  if (!trimmed) return `${normalizedName}:{}`;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return `${normalizedName}:${stableStringify(parsed)}`;
  } catch {
    return `${normalizedName}:${trimmed}`;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function truncateText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export async function runToolLoop(
  client: Client | null,
  executor: ToolExecutor | null,
  messages: Message[],
  tools: ToolDefinition[],
  temperature: number,
  maxTokens: number,
  config: ToolLoopConfig = defaultToolLoopConfig(),
  options: RunToolLoopOptions = {},
): Promise<string> {
  if (!client) throw new Error("LLM client is nil");
  const maxRounds = config.maxRounds > 0 ? config.maxRounds : defaultToolLoopConfig().maxRounds;
  const maxToolCallsPerRound =
    config.maxToolCallsPerRound > 0
      ? config.maxToolCallsPerRound
      : defaultToolLoopConfig().maxToolCallsPerRound;

  const step = options.step?.trim() || "tool_loop";
  const recorder = options.recorder ?? null;
  const finalSynthesisOnExhaustion = options.finalSynthesisOnExhaustion !== false;

  const working: Message[] = [...messages];
  const useTools = tools.length > 0 && executor !== null;
  const seenCalls = new Set<string>();
  let totalExecutedCalls = 0;

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

    const roundSummaries: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const callKey = normalizeCallKey(call.name, call.arguments);
      const started = Date.now();
      let output: string;
      let deduped = false;
      let execError = "";

      if (seenCalls.has(callKey)) {
        deduped = true;
        output =
          `Notice: identical call ${call.name}(${truncateText(call.arguments, 160)}) was already executed earlier in this loop. ` +
          `Reuse the previous result and stop calling tools once you have enough information.`;
      } else {
        seenCalls.add(callKey);
        try {
          output = await executor.execute(call.name, call.arguments);
        } catch (error) {
          execError = error instanceof Error ? error.message : String(error);
          output = `tool error: ${execError}`;
        }
        totalExecutedCalls += 1;
      }

      const durationMs = Date.now() - started;
      roundSummaries.push({
        name: call.name,
        arguments: truncateText(call.arguments, 300),
        result_chars: [...output].length,
        duration_ms: durationMs,
        ...(deduped ? { deduped: true } : {}),
        ...(execError ? { error: execError } : { result_preview: truncateText(output, 240) }),
      });

      working.push({
        role: "tool",
        content: output,
        tool_call_id: call.id,
        name: call.name,
      });
    }

    const remaining = maxRounds - round - 1;
    recorder?.record(step, "tool_round", `round ${round + 1}/${maxRounds}: ${calls.map((c) => c.name).join(", ")}`, {
      round: round + 1,
      max_rounds: maxRounds,
      remaining_rounds: remaining,
      calls: roundSummaries,
    });

    if (remaining === 1 || remaining === 2) {
      working.push({
        role: "user",
        content: `注意：工具调用预算仅剩 ${remaining} 轮。请仅在绝对必要时做最后一次精准查询，否则请立即基于已查结果按要求格式输出最终结果。`,
      });
    }
  }

  if (finalSynthesisOnExhaustion && useTools && totalExecutedCalls > 0) {
    recorder?.record(step, "warn", `tool loop reached max rounds (${maxRounds}); forcing final tool-free synthesis`, {
      max_rounds: maxRounds,
      executed_calls: totalExecutedCalls,
    });
    working.push({
      role: "user",
      content: `工具调用轮次已达上限（${maxRounds} 轮）。请停止继续调用工具，立即基于前面已查询到的所有信息按要求格式输出最终结果。`,
    });
    const finalResult: ChatResult = await client.chat(working, null, temperature, maxTokens);
    if (finalResult.content.trim()) {
      return finalResult.content;
    }
  }

  throw new Error(`tool loop exceeded max rounds (${maxRounds})`);
}
