import { describe, expect, it } from "vitest";
import { SEED_TOPIC_FOLDERS, WORKSPACE_DIRS } from "./scaffold.js";

describe("workspace pyramid scaffold", () => {
  it("seeds seven readable domains and two-level groups without legacy type roots", () => {
    const domains = SEED_TOPIC_FOLDERS.filter((folder) => !folder.path.includes("/"));
    expect(domains.map((folder) => folder.display_name)).toHaveLength(7);
    expect(SEED_TOPIC_FOLDERS.every((folder) => folder.description.includes("收"))).toBe(true);
    expect(SEED_TOPIC_FOLDERS.filter((folder) => folder.path.includes("/")).every((folder) => folder.path.split("/").length === 2)).toBe(true);
    expect(WORKSPACE_DIRS).not.toContain("wiki/concepts");
    expect(WORKSPACE_DIRS).not.toContain("wiki/entities");
    expect(WORKSPACE_DIRS).not.toContain("wiki/devices");
  });
});
