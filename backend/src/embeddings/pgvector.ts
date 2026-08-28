// pgvector's text input format: a bracketed, comma-separated float list. No
// pgvector client library needed for either direction — the seed script casts a
// stored vector with `$1::vector`, and hybrid search casts a query vector the
// same way to compare against them (`embedding <=> $2::vector`).
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
