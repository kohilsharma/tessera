// pgvector's text input format: a bracketed, comma-separated float list. No
// pgvector client library needed for this one-directional write — the seed
// script casts it with `$1::vector` and Foundation never reads it back.
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
