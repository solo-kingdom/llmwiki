export interface JsonRepairResult<T = unknown> {
  value: T;
  json: string;
  repaired: boolean;
}

interface FencedCandidate {
  lang: string;
  body: string;
  order: number;
}

/**
 * Extracts candidate JSON blocks from an LLM response:
 * 1. Fenced code blocks (prioritizing ```json, then blocks containing "pages"/"changes", then later blocks)
 * 2. Top-level balanced `{...}` objects scanned from raw text
 * 3. Fallback `indexOf("{") .. lastIndexOf("}")` slice
 */
export function extractJsonCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  const fenced: FencedCandidate[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let order = 0;
  let lastMatchedEnd = 0;
  while ((match = fenceRegex.exec(raw)) !== null) {
    fenced.push({
      lang: (match[1] ?? "").trim().toLowerCase(),
      body: (match[2] ?? "").trim(),
      order: order++,
    });
    lastMatchedEnd = fenceRegex.lastIndex;
  }

  // Handle unclosed trailing fence (e.g., truncated output after ```json)
  const tail = raw.slice(lastMatchedEnd);
  const unclosedMatch = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*)$/.exec(tail);
  if (unclosedMatch) {
    const body = (unclosedMatch[2] ?? "").trim();
    if (body.includes("{")) {
      fenced.push({
        lang: (unclosedMatch[1] ?? "").trim().toLowerCase(),
        body,
        order: order++,
      });
    }
  }

  const langRank = (lang: string): number => {
    if (lang === "json" || lang === "jsonc") return 3;
    if (lang === "") return 2;
    return 1;
  };
  const hasPlanKeyword = (body: string): number =>
    body.includes('"pages"') || body.includes('"changes"') ? 1 : 0;

  fenced
    .filter((item) => item.body.length > 0)
    .sort((a, b) => {
      const rankDiff = langRank(b.lang) - langRank(a.lang);
      if (rankDiff !== 0) return rankDiff;
      const kwDiff = hasPlanKeyword(b.body) - hasPlanKeyword(a.body);
      if (kwDiff !== 0) return kwDiff;
      return b.order - a.order;
    })
    .forEach((item) => add(item.body));

  // Scan top-level balanced `{...}` objects from raw text
  const balancedObjects = extractBalancedObjects(raw);
  balancedObjects
    .sort((a, b) => hasPlanKeyword(b) - hasPlanKeyword(a))
    .forEach((obj) => add(obj));

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    add(raw.slice(firstBrace, lastBrace + 1));
  }

  return candidates;
}

function extractBalancedObjects(raw: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

/**
 * Deterministically repairs common LLM-produced JSON issues:
 * - Unescaped ASCII double quotes inside JSON string values
 * - Unescaped raw control characters (\n, \r, \t, etc.) inside strings
 * - Trailing commas before `}` or `]`
 */
export function repairJsonText(input: string): string {
  const trimmed = input.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "";

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Proceed with state-machine repair
  }

  const out: string[] = [];
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let stringIsKey = false;
  let expectKey = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;

    if (inString) {
      if (escaped) {
        out.push(ch);
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out.push(ch);
        escaped = true;
        continue;
      }
      if (ch === "\n") {
        out.push("\\n");
        continue;
      }
      if (ch === "\r") {
        out.push("\\r");
        continue;
      }
      if (ch === "\t") {
        out.push("\\t");
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out.push(`\\u${code.toString(16).padStart(4, "0")}`);
        continue;
      }
      if (ch === '"') {
        if (isClosingQuote(trimmed, i, stack, stringIsKey)) {
          out.push('"');
          inString = false;
          if (stringIsKey) expectKey = false;
        } else {
          out.push('\\"');
        }
        continue;
      }
      out.push(ch);
      continue;
    }

    // Outside string
    if (ch === '"') {
      const top = stack[stack.length - 1];
      stringIsKey = top === "{" && expectKey;
      inString = true;
      out.push('"');
      continue;
    }

    if (ch === "{") {
      stack.push("{");
      expectKey = true;
      out.push(ch);
      continue;
    }

    if (ch === "[") {
      stack.push("[");
      expectKey = false;
      out.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length > 0) stack.pop();
      expectKey = false;
      out.push(ch);
      continue;
    }

    if (ch === ":") {
      expectKey = false;
      out.push(ch);
      continue;
    }

    if (ch === ",") {
      const nextIdx = skipWhitespace(trimmed, i + 1);
      const nextCh = nextIdx < trimmed.length ? trimmed[nextIdx] : "";
      if (nextCh === "}" || nextCh === "]") {
        // Drop trailing comma
        continue;
      }
      const top = stack[stack.length - 1];
      expectKey = top === "{";
      out.push(ch);
      continue;
    }

    out.push(ch);
  }

  return out.join("");
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

function isClosingQuote(
  text: string,
  quoteIndex: number,
  stack: Array<"{" | "[">,
  stringIsKey: boolean,
): boolean {
  const nextIdx = skipWhitespace(text, quoteIndex + 1);
  if (nextIdx >= text.length) return true;
  const nextCh = text[nextIdx]!;

  if (stringIsKey) {
    return nextCh === ":";
  }

  const top = stack[stack.length - 1];
  if (top === undefined) {
    return nextIdx >= text.length;
  }

  if (top === "{" && nextCh === "}") return true;
  if (top === "[" && nextCh === "]") return true;

  if (nextCh === ",") {
    const afterCommaIdx = skipWhitespace(text, nextIdx + 1);
    if (afterCommaIdx >= text.length) return true;
    const afterComma = text[afterCommaIdx]!;

    if (top === "{") {
      if (afterComma === "}") return true;
      if (afterComma === '"') {
        return looksLikeObjectKeyStart(text, afterCommaIdx);
      }
      return false;
    }

    if (top === "[") {
      return (
        afterComma === "]" ||
        afterComma === '"' ||
        afterComma === "{" ||
        afterComma === "[" ||
        afterComma === "-" ||
        (afterComma >= "0" && afterComma <= "9") ||
        afterComma === "t" ||
        afterComma === "f" ||
        afterComma === "n"
      );
    }
  }

  return false;
}

function looksLikeObjectKeyStart(text: string, quoteStart: number): boolean {
  // Scan forward for closing `"` on the same line followed by `:`
  for (let i = quoteStart + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n" || ch === "\r") return false;
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === '"') {
      const afterKeyIdx = skipWhitespace(text, i + 1);
      return afterKeyIdx < text.length && text[afterKeyIdx] === ":";
    }
  }
  return false;
}

/**
 * Extracts JSON candidates from raw text and tries native JSON.parse first across all candidates,
 * then falls back to deterministic repairJsonText + JSON.parse.
 */
export function parseJsonWithRepair<T = unknown>(
  raw: string,
  predicate?: (value: unknown) => boolean,
): JsonRepairResult<T> | null {
  const candidates = extractJsonCandidates(raw);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!predicate || predicate(parsed)) {
        return { value: parsed as T, json: candidate, repaired: false };
      }
    } catch {
      // try next
    }
  }

  for (const candidate of candidates) {
    const repaired = repairJsonText(candidate);
    if (!repaired) continue;
    try {
      const parsed = JSON.parse(repaired) as unknown;
      if (!predicate || predicate(parsed)) {
        return { value: parsed as T, json: repaired, repaired: true };
      }
    } catch {
      // try next
    }
  }

  return null;
}
