import { composeSystemPrompt } from "./prompts.js";
import { recordLLMRequest, recordLLMResponse } from "./job_events.js";
import type { MergeContext, Section, SectionDiff } from "./types.js";

const MERGE_MIN_BODY_RATIO = 0.7;

function runeLength(value: string): number {
  return [...value].length;
}

export function splitSections(body: string): Section[] {
  if (!body.trim()) return [];
  const sections: Section[] = [];
  let heading = "";
  let lines: string[] = [];

  const flush = () => {
    if (lines.length === 0 && heading === "") return;
    sections.push({ heading, content: lines.join("\n").replace(/\n+$/, "") });
  };

  for (const line of body.split("\n")) {
    if (/^## /.test(line)) {
      flush();
      heading = line;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

export function diffSections(oldSections: Section[], newSections: Section[]): SectionDiff[] {
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const diffs: SectionDiff[] = [];

  for (let iNew = 0; iNew < newSections.length; iNew += 1) {
    const next = newSections[iNew]!;
    for (let iOld = 0; iOld < oldSections.length; iOld += 1) {
      if (usedOld.has(iOld)) continue;
      const previous = oldSections[iOld]!;
      if (headingMatch(previous.heading, next.heading)) {
        usedOld.add(iOld);
        usedNew.add(iNew);
        diffs.push({
          type: previous.content === next.content ? "unchanged" : "modified",
          old: previous,
          new: next,
          similarity: previous.content === next.content ? 1 : sectionSimilarity(previous.content, next.content),
        });
        break;
      }
    }
  }

  for (let iNew = 0; iNew < newSections.length; iNew += 1) {
    if (usedNew.has(iNew)) continue;
    const next = newSections[iNew]!;
    let bestOld = -1;
    let bestSimilarity = 0;
    for (let iOld = 0; iOld < oldSections.length; iOld += 1) {
      if (usedOld.has(iOld)) continue;
      const previous = oldSections[iOld]!;
      if (!previous.heading || !next.heading) continue;
      const similarity = headingSimilarity(previous.heading, next.heading);
      if (similarity > bestSimilarity && similarity >= 0.6) {
        bestSimilarity = similarity;
        bestOld = iOld;
      }
    }
    if (bestOld >= 0) {
      usedOld.add(bestOld);
      usedNew.add(iNew);
      const previous = oldSections[bestOld]!;
      diffs.push({
        type: previous.content === next.content ? "unchanged" : "modified",
        old: previous,
        new: next,
        similarity: previous.content === next.content ? 1 : sectionSimilarity(previous.content, next.content),
      });
    }
  }

  for (let iNew = 0; iNew < newSections.length; iNew += 1) {
    if (usedNew.has(iNew)) continue;
    const next = newSections[iNew]!;
    if (next.heading !== "") continue;
    for (let iOld = 0; iOld < oldSections.length; iOld += 1) {
      if (usedOld.has(iOld)) continue;
      const previous = oldSections[iOld]!;
      if (previous.heading !== "") continue;
      const similarity = sectionSimilarity(previous.content, next.content);
      if (similarity >= 0.4) {
        usedOld.add(iOld);
        usedNew.add(iNew);
        diffs.push({
          type: previous.content === next.content ? "unchanged" : "modified",
          old: previous,
          new: next,
          similarity,
        });
        break;
      }
    }
  }

  for (let iNew = 0; iNew < newSections.length; iNew += 1) {
    if (!usedNew.has(iNew)) {
      diffs.push({ type: "new", old: null, new: newSections[iNew]!, similarity: 0 });
    }
  }
  for (let iOld = 0; iOld < oldSections.length; iOld += 1) {
    if (!usedOld.has(iOld)) {
      diffs.push({ type: "deleted", old: oldSections[iOld]!, new: null, similarity: 0 });
    }
  }
  return diffs;
}

function headingMatch(a: string, b: string): boolean {
  const left = a.trim().replace(/^##\s*/, "").trim();
  const right = b.trim().replace(/^##\s*/, "").trim();
  return left.toLowerCase() === right.toLowerCase();
}

function headingSimilarity(a: string, b: string): number {
  const left = a.trim().replace(/^##\s*/, "").trim();
  const right = b.trim().replace(/^##\s*/, "").trim();
  if (!left || !right) return 0;
  const loweredLeft = left.toLowerCase();
  const loweredRight = right.toLowerCase();
  if (loweredLeft === loweredRight) return 1;
  if (loweredLeft.includes(loweredRight) || loweredRight.includes(loweredLeft)) return 0.8;
  if (editDistance(loweredLeft, loweredRight) <= 3) return 0.7;
  return 0;
}

export function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let previous = Array.from({ length: lb + 1 }, (_, index) => index);
  let current = new Array<number>(lb + 1);
  for (let i = 1; i <= la; i += 1) {
    current[0] = i;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[lb]!;
}

export function sectionSimilarity(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const leftRunes = [...left].slice(0, 200).join("");
  const rightRunes = [...right].slice(0, 200).join("");
  const leftTrigrams = trigrams(leftRunes);
  const rightTrigrams = trigrams(rightRunes);
  if (leftTrigrams.size === 0 && rightTrigrams.size === 0) return 1;
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0;
  let intersection = 0;
  for (const item of leftTrigrams) if (rightTrigrams.has(item)) intersection += 1;
  const union = leftTrigrams.size + rightTrigrams.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(value: string): Set<string> {
  const runes = [...value];
  const set = new Set<string>();
  for (let i = 0; i + 2 < runes.length; i += 1) {
    set.add(`${runes[i]}${runes[i + 1]}${runes[i + 2]}`);
  }
  return set;
}

export function shouldUseDiffMerge(oldBody: string, newBody: string): boolean {
  if (runeLength(oldBody) < 200 || runeLength(newBody) < 200) return false;
  const oldSections = splitSections(oldBody);
  const newSections = splitSections(newBody);
  if (oldSections.length <= 1 && newSections.length <= 1) return false;

  const diffs = diffSections(oldSections, newSections);
  let modified = 0;
  let total = 0;
  for (const diff of diffs) {
    if (diff.type === "modified") modified += 1;
    if (diff.type !== "unchanged") total += 1;
  }
  const matched = diffs.length - total;
  if (matched === 0 && modified > 0) return false;
  if (modified > 0) {
    const denominator = modified + diffs.length - total;
    if (denominator > 0 && modified / denominator > 0.8) return false;
  }
  return true;
}

async function mergeModifiedSection(
  context: MergeContext,
  oldSection: Section,
  newSection: Section,
): Promise<string> {
  const client = context.llmClient;
  if (!client) return newSection.content;

  const headingLabel = oldSection.heading ? oldSection.heading.replace(/^##\s*/, "") : "前言";
  const systemMessage = composeSystemPrompt("merge_body", {
    workspace: "",
    docLang: context.docLang,
    rulesSupplement: "",
  });
  const userMessage =
    `以下是 wiki 页面中「${headingLabel}」章节的旧正文和新正文。\n` +
    `请合并：保留旧内容所有重要信息，仅补充新内容中的增量。\n` +
    `仅输出合并后的章节正文（不含标题行）。\n\n` +
    `## 旧正文\n\n${oldSection.content}\n\n## 新正文\n\n${newSection.content}`;
  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];
  const temperature = 0.1;
  const maxTokens = 4096;
  recordLLMRequest(context.recorder, "diff_merge_section", client.model, messages, temperature, maxTokens);

  const chunks: string[] = [];
  for await (const event of client.streamChat(messages, temperature, maxTokens)) {
    if (event.type === "token") chunks.push(event.content ?? "");
    if (event.type === "error" && event.error) throw event.error;
  }
  const result = chunks.join("").trim();
  recordLLMResponse(context.recorder, "diff_merge_section", result, 0);
  return result;
}

export async function diffMergeBody(
  context: MergeContext,
  oldBody: string,
  newBody: string,
): Promise<string> {
  if (!shouldUseDiffMerge(oldBody, newBody)) {
    const { mergeBodyLLM } = await import("./merge.js");
    return mergeBodyLLM(context.llmClient, context.docLang, context.recorder, oldBody, newBody);
  }

  const oldSections = splitSections(oldBody);
  const newSections = splitSections(newBody);
  const diffs = diffSections(oldSections, newSections);
  const oldIndex = new Map<Section, number>();
  oldSections.forEach((section, index) => oldIndex.set(section, index));
  diffs.sort((a, b) => {
    const left = a.old ? (oldIndex.get(a.old) ?? oldSections.length) : oldSections.length;
    const right = b.old ? (oldIndex.get(b.old) ?? oldSections.length) : oldSections.length;
    return left - right;
  });

  const parts: string[] = [];
  for (const diff of diffs) {
    if (diff.type === "unchanged" || diff.type === "deleted") {
      if (diff.old) parts.push(formatSection(diff.old));
      continue;
    }
    if (diff.type === "new") {
      if (diff.new) parts.push(formatSection(diff.new));
      continue;
    }
    if (!diff.old || !diff.new) continue;
    try {
      const merged = await mergeModifiedSection(context, diff.old, diff.new);
      parts.push(diff.old.heading ? `${diff.old.heading}\n${merged}` : merged);
    } catch {
      parts.push(formatSection(diff.old));
    }
  }

  const result = parts.join("\n\n").trim();
  const oldLen = runeLength(oldBody);
  if (oldLen > 0) {
    const resultLen = runeLength(result);
    const minLen = Math.floor(oldLen * MERGE_MIN_BODY_RATIO);
    if (resultLen < minLen) {
      throw new Error(
        `diff merge too aggressive: merged ${resultLen} chars < 70% of old ${oldLen} chars`,
      );
    }
  }
  return result;
}

function formatSection(section: Section): string {
  if (!section.heading) return section.content;
  if (!section.content.trim()) return section.heading;
  return `${section.heading}\n${section.content}`;
}
