export interface PermissionRequest {
  sessionId: string;
  toolCallId: string;
  toolKind: string;
  toolTitle: string;
  options: PermissionOption[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionDecision {
  outcome: "selected" | "cancelled";
  option_id?: string;
  allowed: boolean;
  reason?: string;
  tool_kind: string;
  tool_title?: string;
}

export interface PermissionPolicy {
  mode: string;
  allow_read: boolean;
  allow_search: boolean;
  allow_fetch: boolean;
  allow_write: boolean;
  allow_execute: boolean;
}

interface PermissionWire {
  sessionId?: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: string };
  options?: PermissionOption[];
}

export function decodePermissionRequest(raw: unknown): PermissionRequest {
  const wire = (raw ?? {}) as PermissionWire;
  return {
    sessionId: wire.sessionId ?? "",
    toolCallId: wire.toolCall?.toolCallId ?? "",
    toolKind: wire.toolCall?.kind ?? "",
    toolTitle: wire.toolCall?.title ?? "",
    options: Array.isArray(wire.options) ? wire.options : [],
  };
}

export function decidePermission(
  policy: PermissionPolicy,
  readonlyOnly: boolean,
  request: PermissionRequest,
): PermissionDecision {
  const kind = request.toolKind.trim().toLowerCase();
  let allowed = false;
  switch (kind) {
    case "read":
      allowed = policy.allow_read;
      break;
    case "search":
      allowed = policy.allow_search;
      break;
    case "think":
      allowed = true;
      break;
    case "fetch":
      allowed = policy.allow_fetch;
      break;
    case "edit":
    case "delete":
    case "move":
      allowed = policy.allow_write && !readonlyOnly;
      break;
    case "execute":
      allowed = policy.allow_execute && !readonlyOnly;
      break;
    default:
      allowed = false;
  }

  const targetKind = allowed ? "allow_once" : "reject_once";
  const decision: PermissionDecision = {
    outcome: "selected",
    allowed,
    reason: allowed ? "policy_allowed" : "policy_denied",
    tool_kind: kind,
    tool_title: request.toolTitle,
  };
  for (const option of request.options) {
    if (option.kind === targetKind) {
      decision.option_id = option.optionId;
      return decision;
    }
  }
  return {
    outcome: "cancelled",
    allowed: false,
    reason: "no_matching_option",
    tool_kind: kind,
    tool_title: request.toolTitle,
  };
}

export function cancelledDecision(request: PermissionRequest): PermissionDecision {
  return {
    outcome: "cancelled",
    allowed: false,
    reason: "turn_cancelled",
    tool_kind: request.toolKind,
    tool_title: request.toolTitle,
  };
}
