import { EMBEDDING_DIMENSIONS, EmbeddingKind, EmbeddingProvider, embedSequentially } from "./EmbeddingProvider";

// ADR-0017/0023 define the embedding interface and its 1024-dim space; ADR-0003 is
// what requires a Mock provider at all. Deterministic, so seeding/tests never need an API
// key — the same text always yields the same unit vector. FNV-1a seeds a
// xorshift32 PRNG, both pure integer math, no crypto/dependency needed.
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nextUint32(seed: number): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / magnitude);
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    let seed = hashString(text) || 1; // xorshift32 is fixed at 0 for seed 0
    const vector: number[] = [];
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      seed = nextUint32(seed);
      vector.push((seed / 0xffffffff) * 2 - 1);
    }
    return normalize(vector);
  }

  // No batch endpoint wired up for this provider — one request per text.
  embedBatch(texts: string[], kind?: EmbeddingKind): Promise<number[][]> {
    return embedSequentially(this, texts, kind);
  }

}
