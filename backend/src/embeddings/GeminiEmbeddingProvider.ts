import { EMBEDDING_DIMENSIONS, EmbeddingKind, EmbeddingProvider } from "./EmbeddingProvider";

const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly apiBase: string = process.env.EMBEDDING_API_BASE || DEFAULT_API_BASE,
  ) {}

  async embed(text: string, kind: EmbeddingKind = "passage"): Promise<number[]> {
    return (await this.embedBatch([text], kind))[0];
  }

  async embedBatch(texts: string[], kind: EmbeddingKind = "passage"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const modelName = `models/${this.model}`;
    const res = await fetch(`${this.apiBase.replace(/\/$/, "")}/${this.model}:batchEmbedContents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: modelName,
          content: { parts: [{ text }] },
          taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Gemini embedding request failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { embeddings?: { values?: number[] }[] };
    const rows = body.embeddings ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`Gemini returned ${rows.length} vectors for ${texts.length} inputs`);
    }
    return rows.map((row) => {
      const values = row.values ?? [];
      if (values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Gemini returned ${values.length} dimensions, expected ${EMBEDDING_DIMENSIONS} (ADR-0017)`);
      }
      return values;
    });
  }
}
