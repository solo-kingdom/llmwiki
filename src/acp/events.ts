export interface PlanEntry {
  content: string;
  priority?: string;
  status: string;
}

export interface AcpEvent {
  kind:
    | "ignored"
    | "message"
    | "thought"
    | "user_echo"
    | "tool_call"
    | "tool_call_update"
    | "plan"
    | "usage";
  text: string;
  toolCallId: string;
  toolName: string;
  toolKind: string;
  toolStatus: string;
  toolTitle: string;
  toolRawInput?: unknown;
  toolRawOutput?: unknown;
  plan: PlanEntry[];
  raw: Record<string, unknown>;
}

function emptyEvent(): AcpEvent {
  return {
    kind: "ignored",
    text: "",
    toolCallId: "",
    toolName: "",
    toolKind: "",
    toolStatus: "",
    toolTitle: "",
    plan: [],
    raw: {},
  };
}

export function decodeSessionUpdate(raw: unknown): AcpEvent {
  let envelope: Record<string, unknown>;
  if (typeof raw === "string") {
    envelope = JSON.parse(raw) as Record<string, unknown>;
  } else {
    envelope = (raw ?? {}) as Record<string, unknown>;
  }
  const nested = envelope["update"];
  if (nested && typeof nested === "object") {
    envelope = nested as Record<string, unknown>;
  }
  const event = emptyEvent();
  event.raw = envelope;
  const kind = typeof envelope["sessionUpdate"] === "string" ? envelope["sessionUpdate"] : "";
  switch (kind) {
    case "agent_message_chunk":
      event.kind = "message";
      decodeContentBlock(envelope, event);
      break;
    case "agent_thought_chunk":
      event.kind = "thought";
      decodeContentBlock(envelope, event);
      break;
    case "user_message_chunk":
      event.kind = "user_echo";
      decodeContentBlock(envelope, event);
      break;
    case "tool_call":
      event.kind = "tool_call";
      decodeToolCall(envelope, event);
      break;
    case "tool_call_update":
      event.kind = "tool_call_update";
      decodeToolCall(envelope, event);
      break;
    case "plan":
      event.kind = "plan";
      decodePlan(envelope, event);
      break;
    case "usage_update":
      event.kind = "usage";
      break;
    default:
      event.kind = "ignored";
  }
  return event;
}

function decodeContentBlock(update: Record<string, unknown>, event: AcpEvent): void {
  const block = update["content"];
  if (!block || typeof block !== "object") return;
  const content = block as Record<string, unknown>;
  if (content["type"] === "text") {
    event.text = typeof content["text"] === "string" ? content["text"] : "";
    return;
  }
  event.toolRawInput = content;
}

function decodeToolCall(update: Record<string, unknown>, event: AcpEvent): void {
  event.toolCallId = firstString(update, "toolCallId", "tool_call_id");
  event.toolTitle = firstString(update, "title");
  event.toolName = firstString(update, "name") || event.toolTitle;
  event.toolKind = firstString(update, "kind");
  event.toolStatus = firstString(update, "status");
  event.toolRawInput = firstValue(update, "rawInput", "raw_input");
  event.toolRawOutput = firstValue(update, "rawOutput", "raw_output");
}

function decodePlan(update: Record<string, unknown>, event: AcpEvent): void {
  const entries = update["entries"];
  if (!Array.isArray(entries)) return;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    event.plan.push({
      content: firstString(entry, "content"),
      priority: firstString(entry, "priority") || undefined,
      status: firstString(entry, "status"),
    });
  }
}

function firstString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function firstValue(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }
  return undefined;
}
