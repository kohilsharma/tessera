// ADR-0017: fixed 1024-dim space, model-swappable behind this interface.
export const EMBEDDING_DIMENSIONS = 1024;

// Asymmetric-retrieval models (the E5 family, which both NVIDIA's Nemotron and
// the OpenAI-compatible gateways serve) encode a search query and a stored
// document differently, and score far worse when both go in unmarked.
// Providers that don't care ignore it.
export type EmbeddingKind = "query" | "passage";

export interface EmbeddingProvider {
  embed(text: string, kind?: EmbeddingKind): Promise<number[]>;
  // One request for many texts. The rate limits that matter here are counted in
  // *requests* (NVIDIA's free tier is ~40/min across the whole key), so batching
  // is what decides whether embedding a corpus is minutes or hours — not a
  // micro-optimisation. Providers with no batch endpoint just loop.
  embedBatch(texts: string[], kind?: EmbeddingKind): Promise<number[][]>;
}

// Default for providers whose API is one-text-at-a-time.
export async function embedSequentially(
  provider: Pick<EmbeddingProvider, "embed">,
  texts: string[],
  kind?: EmbeddingKind,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) out.push(await provider.embed(text, kind));
  return out;
}
