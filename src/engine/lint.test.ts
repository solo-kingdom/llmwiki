import { describe, expect, it } from "vitest";
import { extractLinkTargets, resolveWikiTarget } from "./lint.js";

const index = new Map<string, string>([
  ["wiki/entities/adam_foroughi.md", "wiki/entities/Adam_Foroughi.md"],
  ["wiki/entities/adam_foroughi", "wiki/entities/Adam_Foroughi.md"],
  ["adam_foroughi", "wiki/entities/Adam_Foroughi.md"],
  ["wiki/concepts/a_player文化.md", "wiki/concepts/A_Player文化.md"],
  ["wiki/concepts/a_player文化", "wiki/concepts/A_Player文化.md"],
  ["a_player文化", "wiki/concepts/A_Player文化.md"],
]);

describe("lint link targets", () => {
  it("strips the escaped pipe from generated index links", () => {
    expect(
      extractLinkTargets("[[entities/Adam_Foroughi\\|Adam Foroughi]]", "wiki/index.md"),
    ).toEqual(["entities/Adam_Foroughi"]);
  });

  it("resolves space/underscore variants to the canonical page path", () => {
    expect(resolveWikiTarget(index, "Adam Foroughi")).toBe("wiki/entities/Adam_Foroughi.md");
    expect(resolveWikiTarget(index, "entities/Adam Foroughi")).toBe("wiki/entities/Adam_Foroughi.md");
    expect(resolveWikiTarget(index, "concepts/A Player文化")).toBe("wiki/concepts/A_Player文化.md");
  });
});
