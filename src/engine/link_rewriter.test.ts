import { describe, expect, it } from "vitest";
import { rewriteWikiPathLinks } from "./link_rewriter.js";

describe("link_rewriter", () => {
  it("rewrites explicit path wikilinks and markdown links while keeping short links and code blocks intact", () => {
    const input = [
      "See [[concepts/OldPage|Old Page]] and [[wiki/concepts/OldPage#sec]].",
      "Also check [[OldPage]] short link.",
      "Markdown: [link](/wiki/concepts/OldPage.md) and [rel](../concepts/OldPage.md).",
      "```md",
      "[[concepts/OldPage]]",
      "[code](/wiki/concepts/OldPage.md)",
      "```",
    ].join("\n");

    const { content, changed } = rewriteWikiPathLinks(
      input,
      [{ oldRelPath: "wiki/concepts/OldPage.md", newRelPath: "wiki/AI/Agent/NewPage.md" }],
      "wiki/AI/Other.md",
    );

    expect(changed).toBe(true);
    expect(content).toContain("[[AI/Agent/NewPage|Old Page]]");
    expect(content).toContain("[[wiki/AI/Agent/NewPage#sec]]");
    expect(content).toContain("[[OldPage]]");
    expect(content).toContain("[link](/wiki/AI/Agent/NewPage.md)");
    expect(content).toContain("[rel](/wiki/AI/Agent/NewPage.md)");
    expect(content).toContain("```md\n[[concepts/OldPage]]\n[code](/wiki/concepts/OldPage.md)\n```");
  });
});
