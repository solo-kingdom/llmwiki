import { describe, expect, it } from "vitest";
import {
  evaluateWikiPlacement,
  parseStructurePolicyMode,
  writeOriginForChangeSet,
} from "./placement_policy.js";

const folders = new Set(["系统与网络", "系统与网络/代理与DNS"]);

describe("wiki placement policy", () => {
  it("defaults to legacy and parses only explicit modes", () => {
    expect(parseStructurePolicyMode("")).toBe("legacy");
    expect(parseStructurePolicyMode("REPORT")).toBe("report");
    expect(parseStructurePolicyMode("enforce")).toBe("enforce");
    expect(() => parseStructurePolicyMode("strict")).toThrow("structure_policy_mode");
  });

  it("reports but allows legacy roots in report mode", () => {
    const decision = evaluateWikiPlacement("wiki/concepts/DNS.md", {
      mode: "report",
      origin: "auto_ingest",
      existing: false,
      folders,
    });
    expect(decision.legacy).toBe(true);
    expect(decision.warnings).toHaveLength(1);
  });

  it("rejects new automatic legacy pages in enforce mode but allows existing updates", () => {
    expect(() => evaluateWikiPlacement("wiki/entities/DNS.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("legacy");

    const update = evaluateWikiPlacement("wiki/entities/DNS.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: true,
      folders,
    });
    expect(update.warnings[0]).toContain("旧页面原地更新");
  });

  it("requires a registered topic group for new automatic pages", () => {
    expect(() => evaluateWikiPlacement("wiki/系统与网络/DNS.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("主题域/主题组");
    expect(() => evaluateWikiPlacement("wiki/系统与网络/未登记/DNS.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("未登记");
    expect(() => evaluateWikiPlacement("wiki/系统与网络/代理与DNS/DNS.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).not.toThrow();
  });

  it("keeps sources, migration, rollback and reindex compatible", () => {
    for (const origin of ["migration", "rollback", "reindex"] as const) {
      expect(() => evaluateWikiPlacement("wiki/concepts/legacy.md", {
        mode: "enforce",
        origin,
        existing: false,
        folders,
      })).not.toThrow();
    }
    expect(() => evaluateWikiPlacement("wiki/sources/input.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).not.toThrow();
    expect(writeOriginForChangeSet("rollback")).toBe("rollback");
    expect(writeOriginForChangeSet("import")).toBe("migration");
    expect(writeOriginForChangeSet("ingest")).toBe("auto_ingest");
  });
});
