import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../engine/frontmatter.js";
import { mergeFrontmatter } from "./merge.js";

describe("mergeFrontmatter", () => {
  it("unions aliases/symptoms and preserves archive locks while updating verification fields", () => {
    const oldYaml = [
      "title: PG Pool",
      "type: experience",
      "kind: pitfall",
      "status: draft",
      "confidence: low",
      "created: 2026-11-01",
      "aliases: [pg-pool]",
      "symptoms: [timeout]",
      "archived_at: 2026-11-10",
      "archive_reason: old-reason",
    ].join("\n");
    const newYaml = [
      "title: Different Title",
      "type: concept",
      "status: validated",
      "confidence: high",
      "last_verified: 2026-11-25",
      "review_after: 2027-02-25",
      "aliases: [pg-pool, pool-exhausted]",
      "symptoms: [too many clients]",
      "archived_at: ''",
    ].join("\n");

    const merged = mergeFrontmatter(oldYaml, newYaml);
    const fm = parseFrontmatter(`---\n${merged}---\n\nBody`);
    expect(fm.title).toBe("PG Pool");
    expect(fm.type).toBe("experience");
    expect(fm.created).toBe("2026-11-01");
    expect(fm.archived_at).toBe("2026-11-10");
    expect(fm.archive_reason).toBe("old-reason");
    expect(fm.confidence).toBe("high");
    expect(fm.status).toBe("validated");
    expect(fm.last_verified).toBe("2026-11-25");
    expect(fm.review_after).toBe("2027-02-25");
    expect(fm.aliases).toEqual(["pg-pool", "pool-exhausted"]);
    expect(fm.symptoms).toEqual(["timeout", "too many clients"]);
  });
});
