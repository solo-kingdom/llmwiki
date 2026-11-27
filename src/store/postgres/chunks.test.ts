import { describe, expect, it } from "vitest";
import { tokenizeSearchQuery } from "./chunks.js";

describe("tokenizeSearchQuery", () => {
  it("expands CJK sequences into bigrams alongside ASCII terms", () => {
    const tokens = tokenizeSearchQuery("DNS 多源解析 401");
    expect(tokens.flatTerms).toContain("dns");
    expect(tokens.flatTerms).toContain("401");
    expect(tokens.flatTerms).toContain("多源解析");
    expect(tokens.flatTerms).toContain("多源");
    expect(tokens.flatTerms).toContain("源解");
    expect(tokens.flatTerms).toContain("解析");
    expect(tokens.groups).toHaveLength(3);
  });

  it("caps total tokens at 12", () => {
    const tokens = tokenizeSearchQuery("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi");
    expect(tokens.flatTerms.length).toBeLessThanOrEqual(12);
  });
});
