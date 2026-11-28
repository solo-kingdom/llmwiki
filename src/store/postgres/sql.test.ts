import { describe, expect, it } from "vitest";
import { asUtcTimestamp, toDbUtcTimestamp } from "./sql.js";

describe("asUtcTimestamp", () => {
  it("normalizes bare Postgres UTC timestamps to ISO-8601 Z", () => {
    expect(asUtcTimestamp("2026-11-28 10:10:51")).toBe("2026-11-28T10:10:51Z");
    expect(asUtcTimestamp("2026-11-28 10:10:51.123")).toBe("2026-11-28T10:10:51.123Z");
    expect(asUtcTimestamp("2026-11-28T10:10:51")).toBe("2026-11-28T10:10:51Z");
  });

  it("preserves already timezone-qualified timestamps, date-only strings, and empty values", () => {
    expect(asUtcTimestamp("2026-11-28T10:10:51Z")).toBe("2026-11-28T10:10:51Z");
    expect(asUtcTimestamp("2026-11-28T18:10:51+08:00")).toBe("2026-11-28T18:10:51+08:00");
    expect(asUtcTimestamp("2026-11-28")).toBe("2026-11-28");
    expect(asUtcTimestamp("")).toBe("");
    expect(asUtcTimestamp(null)).toBe("");
  });
});

describe("toDbUtcTimestamp", () => {
  it("converts ISO-8601 UTC and offset timestamps to DB UTC text format", () => {
    expect(toDbUtcTimestamp("2026-11-28T10:10:51Z")).toBe("2026-11-28 10:10:51");
    expect(toDbUtcTimestamp("2026-11-28T01:05:00+08:00")).toBe("2026-11-27 17:05:00");
    expect(toDbUtcTimestamp("2026-11-28 10:10:51")).toBe("2026-11-28 10:10:51");
    expect(toDbUtcTimestamp("")).toBe("");
  });
});
