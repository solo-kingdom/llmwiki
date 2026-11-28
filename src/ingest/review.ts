import { logger } from "../logger.js";
import { normalizeWikiFilePath } from "./fileblocks.js";
import { extractJsonCandidates, parseJsonWithRepair } from "./json_repair.js";
import type { PlanAction, PlanResult } from "./types.js";

export const REVIEW_REF_PREFIX = "review:";

export function reviewSourceRef(reviewId: string): string {
  return `${REVIEW_REF_PREFIX}${reviewId}`;
}

export function parseReviewIdFromRef(sourceRef: string): string | null {
  if (!sourceRef.startsWith(REVIEW_REF_PREFIX)) return null;
  const id = sourceRef.slice(REVIEW_REF_PREFIX.length);
  return id || null;
}

export function parsePlanResult(raw: string): PlanResult {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty plan response");
  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const repaired =
    parseJsonWithRepair<Record<string, unknown>>(
      trimmed,
      (value) => isObject(value) && ("changes" in value || "summary" in value),
    ) ?? parseJsonWithRepair<Record<string, unknown>>(trimmed, isObject);

  let planJson: string;
  let probe: Record<string, unknown>;
  if (repaired) {
    planJson = repaired.json;
    probe = repaired.value;
  } else {
    const candidates = extractJsonCandidates(trimmed);
    planJson = candidates[0] ?? '{"summary":"","changes":[]}';
    probe = JSON.parse(planJson) as Record<string, unknown>;
  }
  let markdown = stripJsonFence(trimmed).trim();
  if (!markdown && typeof probe.summary === "string") markdown = probe.summary;
  return { planMarkdown: markdown, planJson };
}

function stripJsonFence(raw: string): string {
  for (const marker of ["```json", "```"]) {
    const index = raw.indexOf(marker);
    if (index >= 0) return raw.slice(0, index).trim();
  }
  return raw;
}

export function formatFeedbackForPlan(feedback: string[]): string {
  if (feedback.length === 0) return "";
  const lines = ["User feedback to incorporate:"];
  let counter = 0;
  for (const item of feedback) {
    const value = item.trim();
    if (!value) continue;
    counter += 1;
    lines.push(`${counter}. ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

interface PlanChangesJson {
  summary?: string;
  changes?: PlanAction[];
}

export function parsePlanActions(planJson: string): PlanAction[] {
  let plan: PlanChangesJson;
  try {
    plan = JSON.parse(planJson) as PlanChangesJson;
  } catch (error) {
    logger.warn({ error }, "ParsePlanActions: failed to parse plan JSON");
    return [];
  }
  const result: PlanAction[] = [];
  for (const change of plan.changes ?? []) {
    if (change.action === "move" && change.from_path) result.push(change);
    else if (change.action === "merge" && (change.source_paths?.length ?? 0) > 0) result.push(change);
  }
  return result;
}

export function planStructuralCounts(planJson: string): {
  moveCount: number;
  mergeCount: number;
  summary: string;
} {
  let plan: PlanChangesJson;
  try {
    plan = JSON.parse(planJson) as PlanChangesJson;
  } catch {
    return { moveCount: 0, mergeCount: 0, summary: "" };
  }
  let moveCount = 0;
  let mergeCount = 0;
  for (const change of plan.changes ?? []) {
    if (change.action === "move" && change.from_path) moveCount += 1;
    if (change.action === "merge" && (change.source_paths?.length ?? 0) > 0) mergeCount += 1;
  }
  return { moveCount, mergeCount, summary: (plan.summary ?? "").trim() };
}

export function sourcePathsToDelete(
  actions: PlanAction[],
  writeTargets: Map<string, string>,
): string[] {
  const toDelete: string[] = [];
  for (const action of actions) {
    if (action.action === "move") {
      if (!action.from_path) continue;
      try {
        const normalized = normalizeWikiFilePath(action.from_path);
        if (writeTargets.has(normalized)) continue;
        toDelete.push(normalized);
      } catch (error) {
        logger.warn({ path: action.from_path, error }, "skipping invalid move source");
      }
    } else if (action.action === "merge") {
      for (const source of action.source_paths ?? []) {
        if (source === action.to_path) continue;
        try {
          const normalized = normalizeWikiFilePath(source);
          if (writeTargets.has(normalized)) continue;
          toDelete.push(normalized);
        } catch (error) {
          logger.warn({ path: source, error }, "skipping invalid merge source");
        }
      }
    }
  }
  return toDelete;
}
