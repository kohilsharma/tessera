import { EMBEDDING_DIMENSIONS, EmbeddingProvider } from "./EmbeddingProvider";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ADR-0023: hosted default. Model is env-configurable, never hardcoded in
// callers (ADR-0003) — this class just supplies the fallback literal.
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${API_BASE}/${this.model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        // ADR-0017's Matryoshka meeting point: truncate the hosted model's
        // native output down to the column's fixed vector(1024).
        embedContentConfig: { outputDimensionality: EMBEDDING_DIMENSIONS },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini embedding request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { embedding: { values: number[] } };
    return body.embedding.values;
  }
}
