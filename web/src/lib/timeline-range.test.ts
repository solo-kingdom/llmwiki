import { describe, expect, it } from "vitest";
import { resolveTimelineRange } from "./timeline-range";

describe("resolveTimelineRange", () => {
  const now = new Date(2026, 10, 28, 18, 10, 0);

  it("returns empty bounds for all", () => {
    expect(resolveTimelineRange("all", "", "", now)).toEqual({});
  });

  it("computes local-day boundaries for today, 7d, 30d, and 90d", () => {
    const today = resolveTimelineRange("today", "", "", now);
    expect(today.from).toBe(new Date(2026, 10, 28, 0, 0, 0, 0).toISOString());
    expect(today.to).toBe(new Date(2026, 10, 28, 23, 59, 59, 0).toISOString());

    const week = resolveTimelineRange("7d", "", "", now);
    expect(week.from).toBe(new Date(2026, 10, 22, 0, 0, 0, 0).toISOString());
    expect(week.to).toBe(today.to);

    const month = resolveTimelineRange("30d", "", "", now);
    expect(month.from).toBe(new Date(2026, 9, 30, 0, 0, 0, 0).toISOString());
    expect(month.to).toBe(today.to);

    const quarter = resolveTimelineRange("90d", "", "", now);
    expect(quarter.from).toBe(new Date(2026, 7, 31, 0, 0, 0, 0).toISOString());
    expect(quarter.to).toBe(today.to);
  });

  it("supports partial custom bounds and flags inverted custom dates", () => {
    expect(resolveTimelineRange("custom", "2026-11-20", "", now)).toEqual({
      from: new Date(2026, 10, 20, 0, 0, 0, 0).toISOString(),
    });
    expect(resolveTimelineRange("custom", "", "2026-11-28", now)).toEqual({
      to: new Date(2026, 10, 28, 23, 59, 59, 0).toISOString(),
    });
    expect(resolveTimelineRange("custom", "2026-11-28", "2026-11-20", now)).toEqual({
      invalid: true,
    });
  });
});
