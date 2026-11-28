export type TextEdit =
  | { op: "replace"; old_text: string; new_text: string; replace_all?: boolean }
  | { op: "replace_lines"; start_line: number; end_line: number; new_text: string }
  | { op: "append"; text: string }
  | { op: "prepend"; text: string }
  | { op: "insert_after"; anchor: string; text: string };

export type TextPatchErrorCode =
  | "PATCH_VALIDATION_ERROR"
  | "PATCH_TARGET_NOT_FOUND"
  | "PATCH_TARGET_AMBIGUOUS"
  | "PATCH_RANGE_ERROR";

export class TextPatchError extends Error {
  constructor(
    public readonly code: TextPatchErrorCode,
    public readonly status: 400 | 409 | 422,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TextPatchError";
  }
}

export interface TextPatchResult {
  content: string;
  applied_edits: number;
  changed: boolean;
  line_delta: number;
}

function findNonOverlappingMatches(source: string, target: string): number[] {
  const lines: number[] = [];
  let idx = 0;
  while (idx <= source.length) {
    const found = source.indexOf(target, idx);
    if (found < 0) break;
    const lineNo = source.slice(0, found).split("\n").length;
    lines.push(lineNo);
    idx = found + target.length;
  }
  return lines;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

/**
 * Apply a sequence of atomic text edits in-memory.
 * Throws TextPatchError if any edit fails validation, target lookup, uniqueness, or line range.
 */
export function applyTextEdits(source: string, edits: TextEdit[]): TextPatchResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new TextPatchError("PATCH_VALIDATION_ERROR", 400, "edits must be a non-empty array");
  }

  let current = source ?? "";

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (!edit || typeof edit !== "object" || typeof edit.op !== "string") {
      throw new TextPatchError("PATCH_VALIDATION_ERROR", 400, `invalid edit at index ${i}`);
    }

    switch (edit.op) {
      case "replace": {
        if (typeof edit.old_text !== "string" || edit.old_text.length === 0) {
          throw new TextPatchError(
            "PATCH_VALIDATION_ERROR",
            400,
            `edit[${i}] replace requires non-empty old_text`,
          );
        }
        if (typeof edit.new_text !== "string") {
          throw new TextPatchError(
            "PATCH_VALIDATION_ERROR",
            400,
            `edit[${i}] replace requires string new_text`,
          );
        }
        const matchLines = findNonOverlappingMatches(current, edit.old_text);
        if (matchLines.length === 0) {
          throw new TextPatchError(
            "PATCH_TARGET_NOT_FOUND",
            422,
            `edit[${i}] target text not found`,
            { edit_index: i, op: "replace" },
          );
        }
        if (matchLines.length > 1 && !edit.replace_all) {
          throw new TextPatchError(
            "PATCH_TARGET_AMBIGUOUS",
            409,
            `edit[${i}] target text matched ${matchLines.length} times; set replace_all=true or provide more context`,
            { edit_index: i, op: "replace", match_count: matchLines.length, match_lines: matchLines },
          );
        }
        current = edit.replace_all
          ? current.split(edit.old_text).join(edit.new_text)
          : current.replace(edit.old_text, () => edit.new_text);
        break;
      }

      case "replace_lines": {
        const lines = current.split("\n");
        const start = edit.start_line;
        const end = edit.end_line;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end < start ||
          end > lines.length
        ) {
          throw new TextPatchError(
            "PATCH_RANGE_ERROR",
            400,
            `edit[${i}] line range ${start}-${end} out of bounds (1-${lines.length})`,
            { edit_index: i, op: "replace_lines", total_lines: lines.length },
          );
        }
        if (typeof edit.new_text !== "string") {
          throw new TextPatchError(
            "PATCH_VALIDATION_ERROR",
            400,
            `edit[${i}] replace_lines requires string new_text`,
          );
        }
        const replacementLines = edit.new_text === "" ? [] : edit.new_text.split("\n");
        lines.splice(start - 1, end - start + 1, ...replacementLines);
        current = lines.join("\n");
        break;
      }

      case "append": {
        if (typeof edit.text !== "string") {
          throw new TextPatchError("PATCH_VALIDATION_ERROR", 400, `edit[${i}] append requires string text`);
        }
        if (edit.text.length > 0) {
          if (!current) {
            current = edit.text;
          } else if (current.endsWith("\n") || edit.text.startsWith("\n")) {
            current += edit.text;
          } else {
            current += `\n${edit.text}`;
          }
        }
        break;
      }

      case "prepend": {
        if (typeof edit.text !== "string") {
          throw new TextPatchError("PATCH_VALIDATION_ERROR", 400, `edit[${i}] prepend requires string text`);
        }
        if (edit.text.length > 0) {
          if (!current) {
            current = edit.text;
          } else if (edit.text.endsWith("\n") || current.startsWith("\n")) {
            current = edit.text + current;
          } else {
            current = `${edit.text}\n${current}`;
          }
        }
        break;
      }

      case "insert_after": {
        if (typeof edit.anchor !== "string" || edit.anchor.length === 0) {
          throw new TextPatchError(
            "PATCH_VALIDATION_ERROR",
            400,
            `edit[${i}] insert_after requires non-empty anchor`,
          );
        }
        if (typeof edit.text !== "string") {
          throw new TextPatchError(
            "PATCH_VALIDATION_ERROR",
            400,
            `edit[${i}] insert_after requires string text`,
          );
        }
        const matchLines = findNonOverlappingMatches(current, edit.anchor);
        if (matchLines.length === 0) {
          throw new TextPatchError(
            "PATCH_TARGET_NOT_FOUND",
            422,
            `edit[${i}] anchor not found`,
            { edit_index: i, op: "insert_after" },
          );
        }
        if (matchLines.length > 1) {
          throw new TextPatchError(
            "PATCH_TARGET_AMBIGUOUS",
            409,
            `edit[${i}] anchor matched ${matchLines.length} times`,
            { edit_index: i, op: "insert_after", match_count: matchLines.length, match_lines: matchLines },
          );
        }
        const pos = current.indexOf(edit.anchor) + edit.anchor.length;
        const before = current.slice(0, pos);
        const after = current.slice(pos);
        const needNewline =
          edit.text.length > 0 && !before.endsWith("\n") && !edit.text.startsWith("\n") ? "\n" : "";
        current = `${before}${needNewline}${edit.text}${after}`;
        break;
      }

      default:
        throw new TextPatchError(
          "PATCH_VALIDATION_ERROR",
          400,
          `unsupported edit op at index ${i}: ${(edit as { op?: unknown }).op}`,
        );
    }
  }

  return {
    content: current,
    applied_edits: edits.length,
    changed: current !== (source ?? ""),
    line_delta: countLines(current) - countLines(source ?? ""),
  };
}
