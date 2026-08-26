import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { MockEmbeddingProvider } from "../src/embeddings/MockEmbeddingProvider";

describe("MockEmbeddingProvider", () => {
  it("is deterministic: the same text always yields the same vector", async () => {
    const provider = new MockEmbeddingProvider();
    const a = await provider.embed("the same headline");
    const b = await provider.embed("the same headline");
    expect(a).toEqual(b);
  });

  it("yields different vectors for different text", async () => {
    const provider = new MockEmbeddingProvider();
    const a = await provider.embed("headline one");
    const b = await provider.embed("headline two");
    expect(a).not.toEqual(b);
  });

  it(`returns a ${EMBEDDING_DIMENSIONS}-dimensional unit vector (ADR-0017)`, async () => {
    const provider = new MockEmbeddingProvider();
    const vector = await provider.embed("any headline");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("handles empty text without producing NaN", async () => {
    const provider = new MockEmbeddingProvider();
    const vector = await provider.embed("");
    expect(vector.every((x) => Number.isFinite(x))).toBe(true);
  });
});
