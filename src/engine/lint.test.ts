import { describe, expect, it } from "vitest";
import { extractLinkTargets, resolveWikiTarget } from "./lint.js";

const index = new Set([
  "wiki/entities/adam_foroughi.md",
  "wiki/entities/adam_foroughi",
  "adam_foroughi",
  "wiki/concepts/a_player文化.md",
  "wiki/concepts/a_player文化",
  "a_player文化",
]);

describe("lint link targets", () => {
  it("strips the escaped pipe from generated index links", () => {
    expect(
      extractLinkTargets("[[entities/Adam_Foroughi\\|Adam Foroughi]]", "wiki/index.md"),
    ).toEqual(["entities/Adam_Foroughi"]);
  });

  it("resolves space/underscore variants", () => {
    expect(resolveWikiTarget(index, "Adam Foroughi")).not.toBe("");
    expect(resolveWikiTarget(index, "entities/Adam Foroughi")).not.toBe("");
    expect(resolveWikiTarget(index, "concepts/A Player文化")).not.toBe("");
  });
});
