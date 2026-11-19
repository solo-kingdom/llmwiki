export interface UnifiedDiffOptions {
  fromFile: string;
  toFile: string;
  context: number;
}

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => `${line}\n`);
}

type Kind = "equal" | "delete" | "insert";
interface Op {
  kind: Kind;
  line: string;
}

function computeOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", line: a[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      ops.push({ kind: "delete", line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "insert", line: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: "delete", line: a[i++]! });
  while (j < m) ops.push({ kind: "insert", line: b[j++]! });
  return ops;
}

export function unifiedDiff(aText: string, bText: string, options: UnifiedDiffOptions): string {
  const ops = computeOps(splitLines(aText), splitLines(bText));
  const context = Math.max(0, options.context);

  const changeIndexes: number[] = [];
  ops.forEach((op, index) => {
    if (op.kind !== "equal") changeIndexes.push(index);
  });
  if (changeIndexes.length === 0) return "";

  const groups: Array<{ start: number; end: number }> = [];
  for (const index of changeIndexes) {
    const last = groups[groups.length - 1];
    if (last && index - last.end <= context * 2) {
      last.end = index;
    } else {
      groups.push({ start: index, end: index });
    }
  }

  const out: string[] = [`--- ${options.fromFile}\n`, `+++ ${options.toFile}\n`];
  let prefixA = 0;
  let prefixB = 0;
  let opCursor = 0;

  for (const group of groups) {
    const from = Math.max(0, group.start - context);
    const to = Math.min(ops.length, group.end + context + 1);
    for (; opCursor < from; opCursor += 1) {
      const op = ops[opCursor]!;
      if (op.kind === "equal" || op.kind === "delete") prefixA += 1;
      if (op.kind === "equal" || op.kind === "insert") prefixB += 1;
    }

    const lines: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (let index = from; index < to; index += 1) {
      const op = ops[index]!;
      if (op.kind === "equal") {
        lines.push(` ${op.line}`);
        aCount += 1;
        bCount += 1;
      } else if (op.kind === "delete") {
        lines.push(`-${op.line}`);
        aCount += 1;
      } else {
        lines.push(`+${op.line}`);
        bCount += 1;
      }
    }
    const aStart = aCount === 0 ? prefixA : prefixA + 1;
    const bStart = bCount === 0 ? prefixB : prefixB + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@\n`);
    out.push(...lines);

    prefixA += aCount;
    prefixB += bCount;
    opCursor = to;
  }
  return out.join("");
}
