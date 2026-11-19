import { describe, expect, it } from "vitest";
import { chunkText, defaultChunkConfig, estimateTokens, splitSentences } from "./chunker.js";

describe("chunker", () => {
  it("uses the documented defaults", () => {
    expect(defaultChunkConfig()).toEqual({ chunkSize: 512, chunkOverlap: 128, minTokens: 32 });
  });

  it("estimates roughly one token per four characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(1);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkText("", 1, defaultChunkConfig())).toEqual([]);
  });

  it("keeps a short document as one chunk with page metadata", () => {
    const text = "A short paragraph about attention and transformers.";
    const chunks = chunkText(text, 7, { chunkSize: 512, chunkOverlap: 0, minTokens: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.page).toBe(7);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.content).toContain("attention");
  });

  it("records the heading breadcrumb", () => {
    const text = "# Architecture\n\n## Ingest pipeline\n\nA pipeline paragraph that is reasonably long enough to keep as a chunk.";
    const chunks = chunkText(text, 1, { chunkSize: 512, chunkOverlap: 0, minTokens: 1 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.at(-1)?.headerBreadcrumb).toBe("Architecture > Ingest pipeline");
  });

  it("splits oversized paragraphs at sentence boundaries", () => {
    const sentence = "This sentence is repeated to exceed the chunk size. ";
    const text = sentence.repeat(40);
    const chunks = chunkText(text, 1, { chunkSize: 64, chunkOverlap: 0, minTokens: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
  });

  it("splits CJK sentence endings", () => {
    expect(splitSentences("第一句。第二句！第三句？")).toEqual(["第一句。", "第二句！", "第三句？"]);
  });
});
