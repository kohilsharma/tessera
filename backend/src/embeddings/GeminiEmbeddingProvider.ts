import { EMBEDDING_DIMENSIONS, EmbeddingProvider } from "./EmbeddingProvider";

// ADR-0003 wants the endpoint env-configurable for the same reason as the
// model: an OpenAI-compatible gateway or a regional host is a config change,
// not a code change. `||` for the same empty-string reason as `model` below.
const API_BASE = process.env.EMBEDDING_API_BASE || "https://generativelanguage.googleapis.com/v1beta/models";

// ADR-0023: hosted default. Model is env-configurable, never hardcoded in
// callers (ADR-0003) — this class just supplies the fallback literal.
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    // `||`, not `??`: a bare `EMBEDDING_MODEL=` line in a .env sets the empty
    // string, which `??` would happily pass through as the model id.
    private readonly model: string = process.env.EMBEDDING_MODEL || "gemini-embedding-001",
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${API_BASE}/${this.model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        // ADR-0017's Matryoshka meeting point: truncate the hosted model's
        // native output down to the column's fixed vector(1024). Nested under
        // embedContentConfig, not top-level: the v1beta body accepts both, but
        // the flat `outputDimensionality` is documented as deprecated in favour
        // of this one. The model itself is a URL path parameter, not a body field.
        embedContentConfig: { outputDimensionality: EMBEDDING_DIMENSIONS },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini embedding request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { embedding?: { values?: number[] } };
    const values = body.embedding?.values ?? [];
    // "embedding" is vector(1024) (ADR-0017). A wrong width otherwise surfaces
    // much later as an opaque Postgres error on the INSERT that stores it, so
    // fail here, where the provider that produced it is still named.
    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Gemini returned ${values.length} dimensions, expected ${EMBEDDING_DIMENSIONS} (ADR-0017)`,
      );
    }
    return values;
  }
}
