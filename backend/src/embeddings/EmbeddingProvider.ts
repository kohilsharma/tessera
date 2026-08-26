// ADR-0017: fixed 1024-dim space, model-swappable behind this interface.
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
