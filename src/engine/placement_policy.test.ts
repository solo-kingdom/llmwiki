import { describe, expect, it } from "vitest";
import {
  OPEN_AUTO_FOLDER_DOMAINS,
  evaluateWikiPlacement,
  parseStructurePolicyMode,
  writeOriginForChangeSet,
} from "./placement_policy.js";

const folders = new Set(["system-network", "system-network/proxy-dns", "products"]);

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

  it("requires a registered topic group and A1 kebab-case slug for new automatic pages", () => {
    expect(() => evaluateWikiPlacement("wiki/system-network/dns.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("主题域/主题组");
    expect(() => evaluateWikiPlacement("wiki/system-network/unregistered/dns.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("未登记");
    expect(() => evaluateWikiPlacement("wiki/system-network/proxy-dns/DNS中文.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).toThrow("kebab-case");
    expect(() => evaluateWikiPlacement("wiki/system-network/proxy-dns/dns.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).not.toThrow();
    expect(() => evaluateWikiPlacement("wiki/system-network/proxy-dns/_overview.md", {
      mode: "enforce",
      origin: "auto_ingest",
      existing: false,
      folders,
    })).not.toThrow();
    expect(OPEN_AUTO_FOLDER_DOMAINS.has("products")).toBe(true);
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
