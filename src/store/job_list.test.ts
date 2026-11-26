import { describe, expect, it } from "vitest";
import {
  JOB_LIST_DEFAULT_LIMIT,
  JOB_LIST_MAX_LIMIT,
  buildIngestJobListWhere,
  clampJobListLimit,
  clampJobListOffset,
  parseJobStatusFilter,
} from "./job_list.js";

describe("ingest job list query", () => {
  it("clamps limit into 1..100 and drops a negative offset", () => {
    expect(clampJobListLimit(0)).toBe(1);
    expect(clampJobListLimit(999)).toBe(JOB_LIST_MAX_LIMIT);
    expect(clampJobListLimit(Number.NaN)).toBe(JOB_LIST_DEFAULT_LIMIT);
    expect(clampJobListLimit(40)).toBe(40);
    expect(clampJobListOffset(-4)).toBe(0);
    expect(clampJobListOffset(20)).toBe(20);
  });

  it("parses a comma-separated status filter and rejects unknown tokens", () => {
    expect(parseJobStatusFilter("")).toEqual([]);
    expect(parseJobStatusFilter(" queued, running ,queued ")).toEqual(["queued", "running"]);
    expect(() => parseJobStatusFilter("nope")).toThrow(/invalid status: nope/);
  });

  it("builds a where clause that treats like wildcards as literal text", () => {
    expect(buildIngestJobListWhere({ statuses: [], inputType: "", query: "" })).toEqual({
      clause: "",
      params: [],
    });

    const built = buildIngestJobListWhere({
      statuses: ["failed"],
      inputType: "text",
      query: "100%_done",
    });
    expect(built.clause).toContain("status = ANY($1::text[])");
    expect(built.clause).toContain("input_type = $2");
    expect(built.clause).toContain("ESCAPE '\\'");
    expect(built.params).toEqual([["failed"], "text", "%100\\%\\_done%"]);
  });
});
