import { describe, it, expect } from "vitest"
import { groupByReview, activeJobOfGroup, isReviewRef } from "./job-grouping"
import type { IngestJob } from "@/types"

function makeJob(overrides: Partial<IngestJob> & { id: string }): IngestJob {
  return {
    parent_job_id: "",
    input_type: "file",
    source_path: "/test/file.md",
    source_ref: "",
    status: "succeeded",
    retries: 0,
    max_retries: 3,
    error: "",
    error_code: "",
    error_message: "",
    missing_dependency: "",
    remediation: "",
    result_summary: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("isReviewRef", () => {
  it("returns true for review: prefix", () => {
    expect(isReviewRef("review:abc123")).toBe(true)
  })

  it("returns false for empty string", () => {
    expect(isReviewRef("")).toBe(false)
  })

  it("returns false for non-review ref", () => {
    expect(isReviewRef("file:/data/test.md")).toBe(false)
  })
})

describe("groupByReview", () => {
  it("returns empty groups and flat for empty list", () => {
    const { groups, flat } = groupByReview([])
    expect(groups.size).toBe(0)
    expect(flat).toEqual([])
  })

  it("groups all review jobs by source_ref", () => {
    const jobs = [
      makeJob({ id: "1", source_ref: "review:aaa", created_at: "2025-01-01T00:00:00Z" }),
      makeJob({ id: "2", source_ref: "review:aaa", created_at: "2025-01-02T00:00:00Z" }),
      makeJob({ id: "3", source_ref: "review:bbb", created_at: "2025-01-01T00:00:00Z" }),
    ]
    const { groups, flat } = groupByReview(jobs)
    expect(groups.size).toBe(2)
    expect(groups.get("review:aaa")!.map((j) => j.id)).toEqual(["2", "1"]) // newest first
    expect(groups.get("review:bbb")!.map((j) => j.id)).toEqual(["3"])
    expect(flat).toEqual([])
  })

  it("puts all non-review jobs into flat array", () => {
    const jobs = [
      makeJob({ id: "1", source_ref: "file:/data/a.md" }),
      makeJob({ id: "2", source_ref: "" }),
    ]
    const { groups, flat } = groupByReview(jobs)
    expect(groups.size).toBe(0)
    expect(flat.map((j) => j.id)).toEqual(["1", "2"])
  })

  it("handles mixed review and non-review jobs", () => {
    const jobs = [
      makeJob({ id: "1", source_ref: "review:aaa", created_at: "2025-01-01T00:00:00Z" }),
      makeJob({ id: "2", source_ref: "file:/data/a.md" }),
      makeJob({ id: "3", source_ref: "review:aaa", created_at: "2025-01-02T00:00:00Z" }),
      makeJob({ id: "4", source_ref: "" }),
    ]
    const { groups, flat } = groupByReview(jobs)
    expect(groups.size).toBe(1)
    expect(groups.get("review:aaa")!.map((j) => j.id)).toEqual(["3", "1"])
    expect(flat.map((j) => j.id)).toEqual(["2", "4"])
  })

  it("handles single review job in a group", () => {
    const jobs = [
      makeJob({ id: "1", source_ref: "review:single", created_at: "2025-01-01T00:00:00Z" }),
    ]
    const { groups, flat } = groupByReview(jobs)
    expect(groups.size).toBe(1)
    expect(groups.get("review:single")!.map((j) => j.id)).toEqual(["1"])
    expect(flat).toEqual([])
  })

  it("sorts group jobs by created_at descending", () => {
    const jobs = [
      makeJob({ id: "oldest", source_ref: "review:x", created_at: "2025-01-01T00:00:00Z" }),
      makeJob({ id: "newest", source_ref: "review:x", created_at: "2025-01-03T00:00:00Z" }),
      makeJob({ id: "middle", source_ref: "review:x", created_at: "2025-01-02T00:00:00Z" }),
    ]
    const { groups } = groupByReview(jobs)
    expect(groups.get("review:x")!.map((j) => j.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ])
  })
})

describe("activeJobOfGroup", () => {
  it("returns the first (newest) job in the sorted group", () => {
    const jobs = [
      makeJob({ id: "newest", created_at: "2025-01-03T00:00:00Z" }),
      makeJob({ id: "oldest", created_at: "2025-01-01T00:00:00Z" }),
    ]
    expect(activeJobOfGroup(jobs).id).toBe("newest")
  })

  it("returns the only job when group has one entry", () => {
    const jobs = [makeJob({ id: "only", created_at: "2025-01-01T00:00:00Z" })]
    expect(activeJobOfGroup(jobs).id).toBe("only")
  })

  it("throws on empty array", () => {
    expect(() => activeJobOfGroup([])).toThrow("empty jobs array")
  })
})
