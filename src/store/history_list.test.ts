import { describe, expect, it } from "vitest";
import {
  buildChangeSetListWhere,
  clampHistoryListLimit,
  clampHistoryListOffset,
  parseHistoryKindFilter,
  parseHistoryTimeBound,
  validateHistoryTimeRange,
} from "./history_list.js";

describe("parseHistoryKindFilter", () => {
  it("normalizes and deduplicates comma-separated kinds", () => {
    expect(parseHistoryKindFilter("")).toEqual([]);
    expect(parseHistoryKindFilter(" ingest , MANUAL, ingest ")).toEqual(["ingest", "manual"]);
  });

  it("rejects unknown kinds", () => {
    expect(() => parseHistoryKindFilter("ingest,unknown")).toThrow("invalid kind: unknown");
  });
});

describe("clampHistoryListLimit & clampHistoryListOffset", () => {
  it("clamps limit to [1, 200] and offset to >= 0", () => {
    expect(clampHistoryListLimit(Number.NaN)).toBe(50);
    expect(clampHistoryListLimit(0)).toBe(1);
    expect(clampHistoryListLimit(999)).toBe(200);
    expect(clampHistoryListOffset(-5)).toBe(0);
    expect(clampHistoryListOffset(25)).toBe(25);
  });
});

describe("parseHistoryTimeBound & validateHistoryTimeRange", () => {
  it("expands date-only bounds for from, before, and to", () => {
    expect(parseHistoryTimeBound("", "from")).toBe("");
    expect(parseHistoryTimeBound("2026-11-28", "from")).toBe("2026-11-28 00:00:00");
    expect(parseHistoryTimeBound("2026-11-28", "before")).toBe("2026-11-28 00:00:00");
    expect(parseHistoryTimeBound("2026-11-28", "to")).toBe("2026-11-28 23:59:59");
  });

  it("normalizes ISO-8601 UTC, offset, and bare DB timestamps to DB UTC text", () => {
    expect(parseHistoryTimeBound("2026-11-28T10:15:30Z", "from")).toBe("2026-11-28 10:15:30");
    expect(parseHistoryTimeBound("2026-11-28T01:00:00+08:00", "from")).toBe("2026-11-27 17:00:00");
    expect(parseHistoryTimeBound("2026-11-28 10:15:30.500", "to")).toBe("2026-11-28 10:15:30");
  });

  it("rejects invalid calendar dates and malformed strings", () => {
    expect(() => parseHistoryTimeBound("2026-02-30", "from")).toThrow("invalid from timestamp");
    expect(() => parseHistoryTimeBound("2026-11-28T25:00:00Z", "to")).toThrow("invalid to timestamp");
    expect(() => parseHistoryTimeBound("not-a-date", "before")).toThrow("invalid before timestamp");
  });

  it("rejects inverted time ranges", () => {
    expect(() => validateHistoryTimeRange("2026-11-28 10:00:00", "2026-11-28 09:59:59")).toThrow(
      "from must not be after to",
    );
    expect(() => validateHistoryTimeRange("2026-11-28 10:00:00", "2026-11-28 10:00:00")).not.toThrow();
  });
});

describe("buildChangeSetListWhere", () => {
  it("builds parameterized WHERE clauses with optional kind exclusion and LIKE escaping", () => {
    const filter = {
      kinds: ["ingest", "manual"],
      query: "100%_test\\path",
      from: "2026-11-27 16:00:00",
      to: "2026-11-28 15:59:59",
      before: "",
    };
    const withKinds = buildChangeSetListWhere(filter, { includeKinds: true });
    expect(withKinds.clause).toContain("cs.kind = ANY($1::text[])");
    expect(withKinds.clause).toContain("cs.created_at >= $2");
    expect(withKinds.clause).toContain("cs.created_at <= $3");
    expect(withKinds.clause).toContain("pr.relative_path ILIKE $4 ESCAPE '\\'");
    expect(withKinds.params).toEqual([
      ["ingest", "manual"],
      "2026-11-27 16:00:00",
      "2026-11-28 15:59:59",
      "%100\\%\\_test\\\\path%",
    ]);

    const withoutKinds = buildChangeSetListWhere(filter, { includeKinds: false });
    expect(withoutKinds.clause).not.toContain("cs.kind");
    expect(withoutKinds.params).toEqual([
      "2026-11-27 16:00:00",
      "2026-11-28 15:59:59",
      "%100\\%\\_test\\\\path%",
    ]);
  });
});
