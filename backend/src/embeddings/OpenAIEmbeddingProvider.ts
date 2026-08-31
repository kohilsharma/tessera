import { postJsonWithRetry } from "../lib/openaiCompatible";
import { EMBEDDING_DIMENSIONS, EmbeddingKind, EmbeddingProvider } from "./EmbeddingProvider";

export type EmbeddingInputStyle = "prefix" | "input_type";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly apiBase: string,
    private readonly inputStyle: EmbeddingInputStyle = "prefix",
  ) {}

  async embed(text: string, kind: EmbeddingKind = "passage"): Promise<number[]> {
    return (await this.embedBatch([text], kind))[0];
  }

  async embedBatch(texts: string[], kind: EmbeddingKind = "passage"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.model,
      input: this.inputStyle === "prefix" ? texts.map((text) => `${kind}: ${text}`) : texts,
    };
    if (this.inputStyle === "input_type") body.input_type = kind;

    const parsed = (await postJsonWithRetry(
      `${this.apiBase.replace(/\/$/, "")}/embeddings`,
      this.apiKey,
      body,
      "embeddings",
    )) as { data?: { embedding?: number[]; index?: number }[] };
    const rows = parsed.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`embedding batch returned ${rows.length} vectors for ${texts.length} inputs`);
    }
    const out: number[][] = new Array(texts.length);
    rows.forEach((row, index) => {
      out[row.index ?? index] = this.toStoredVector(row.embedding ?? []);
    });
    return out;
  }

  private toStoredVector(values: number[]): number[] {
    if (values.length < EMBEDDING_DIMENSIONS) {
      throw new Error(
        `${this.model} returned ${values.length} dimensions, need at least ${EMBEDDING_DIMENSIONS} (ADR-0017)`,
      );
    }
    const truncated = values.slice(0, EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(truncated.reduce((sum, value) => sum + value * value, 0)) || 1;
    return truncated.map((value) => value / magnitude);
  }
}
