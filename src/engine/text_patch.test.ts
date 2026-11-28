import { describe, expect, it } from "vitest";
import { applyTextEdits, TextPatchError } from "./text_patch.js";

describe("applyTextEdits", () => {
  it("applies sequential replace, replace_lines, insert_after, prepend, and append", () => {
    const src = ["line 1", "target alpha", "line 3", "line 4"].join("\n");
    const res = applyTextEdits(src, [
      { op: "replace", old_text: "target alpha", new_text: "target beta" },
      { op: "replace_lines", start_line: 3, end_line: 4, new_text: "replaced 3-4" },
      { op: "insert_after", anchor: "target beta", text: "inserted line" },
      { op: "prepend", text: "header" },
      { op: "append", text: "footer" },
    ]);
    expect(res.applied_edits).toBe(5);
    expect(res.changed).toBe(true);
    expect(res.content).toBe(["header", "line 1", "target beta", "inserted line", "replaced 3-4", "footer"].join("\n"));
  });

  it("supports replace_all=true and deletes lines when replace_lines new_text is empty", () => {
    const res = applyTextEdits("foo\nfoo\nbar", [
      { op: "replace", old_text: "foo", new_text: "baz", replace_all: true },
      { op: "replace_lines", start_line: 2, end_line: 2, new_text: "" },
    ]);
    expect(res.content).toBe("baz\nbar");
    expect(res.line_delta).toBe(-1);
  });

  it("throws 422 PATCH_TARGET_NOT_FOUND when replace or insert_after target is missing", () => {
    expect(() => applyTextEdits("hello", [{ op: "replace", old_text: "missing", new_text: "x" }])).toThrowError(
      TextPatchError,
    );
    try {
      applyTextEdits("hello", [{ op: "insert_after", anchor: "missing", text: "x" }]);
    } catch (err) {
      expect(err).toBeInstanceOf(TextPatchError);
      expect((err as TextPatchError).status).toBe(422);
      expect((err as TextPatchError).code).toBe("PATCH_TARGET_NOT_FOUND");
    }
  });

  it("throws 409 PATCH_TARGET_AMBIGUOUS with match_count and match_lines", () => {
    try {
      applyTextEdits("dup\nok\ndup", [{ op: "replace", old_text: "dup", new_text: "one" }]);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TextPatchError);
      const e = err as TextPatchError;
      expect(e.status).toBe(409);
      expect(e.code).toBe("PATCH_TARGET_AMBIGUOUS");
      expect(e.details?.match_count).toBe(2);
      expect(e.details?.match_lines).toEqual([1, 3]);
    }
  });

  it("throws 400 PATCH_RANGE_ERROR on invalid line range", () => {
    try {
      applyTextEdits("a\nb", [{ op: "replace_lines", start_line: 2, end_line: 5, new_text: "x" }]);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TextPatchError);
      expect((err as TextPatchError).status).toBe(400);
      expect((err as TextPatchError).code).toBe("PATCH_RANGE_ERROR");
    }
  });
});
