import { postJsonWithRetry } from "../lib/openaiCompatible";
import { EMBEDDING_DIMENSIONS, EmbeddingKind, EmbeddingProvider } from "./EmbeddingProvider";

// How a provider is told that a text is a query rather than a document.
// - "prefix": glue "query: "/"passage: " onto the text yourself. What a plain
//   OpenAI-compatible gateway needs, since it passes `input` through untouched.
// - "input_type": send it as a body field and let the server apply its own
//   prefix. What NVIDIA's NIM embedding endpoints expect; prefixing by hand as
//   well would double it.
export type EmbeddingInputStyle = "prefix" | "input_type";

// NVIDIA names the document side "passage"; that matches our own vocabulary, so
// the value goes over the wire unchanged.
// Any OpenAI-compatible /embeddings endpoint (ADR-0003: no hardcoded model ids
// or hosts) — NVIDIA's own https://integrate.api.nvidia.com/v1 included. Same
// 1024-dim contract as the other providers: ADR-0017's Matryoshka meeting
// point, reached by truncating whatever width the server returns rather than by
// asking for a width it may not offer.
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    // `||`, not `??`: a bare `EMBEDDING_MODEL=` line in a .env sets the empty
    // string, which `??` would pass straight through as the model id.
    private readonly model: string = process.env.EMBEDDING_MODEL || "nvidia/nemotron-3-embed-1b",
    private readonly apiBase: string = process.env.EMBEDDING_API_BASE || "https://integrate.api.nvidia.com/v1",
    private readonly inputStyle: EmbeddingInputStyle =
      process.env.EMBEDDING_INPUT_STYLE === "input_type" ? "input_type" : "prefix",
  ) {}

  async embed(text: string, kind: EmbeddingKind = "passage"): Promise<number[]> {
    return (await this.embedBatch([text], kind))[0];
  }

  async embedBatch(texts: string[], kind: EmbeddingKind = "passage"): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Marking query vs document is not cosmetic: measured against an
    // unprefixed E5-family model, a paraphrase scored 0.42 while random
    // gibberish scored 0.60 — the ranking inverts. Prefixed, the same pair
    // separates 0.52 to 0.10.
    const body: Record<string, unknown> = {
      model: this.model,
      input: this.inputStyle === "prefix" ? texts.map((t) => `${kind}: ${t}`) : texts,
    };
    if (this.inputStyle === "input_type") body.input_type = kind;

    const parsed = (await postJsonWithRetry(
      `${this.apiBase}/embeddings`,
      this.apiKey,
      body,
      "embeddings",
    )) as { data?: { embedding?: number[]; index?: number }[] };
    const rows = parsed.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`embedding batch returned ${rows.length} vectors for ${texts.length} inputs`);
    }
    // `index` is what maps a vector back to its input; the spec does not promise
    // response order, and silently mis-pairing vectors with articles is the kind
    // of bug that only shows up as bad search results months later.
    const out: number[][] = new Array(texts.length);
    rows.forEach((row, i) => {
      out[row.index ?? i] = this.toStoredVector(row.embedding ?? []);
    });
    return out;
  }


  private toStoredVector(values: number[]): number[] {
    // The served model is wider than the column (Nemotron is 2048) and may
    // reject a `dimensions` request for anything else, so the cut happens here.
    // NVIDIA's model card sanctions exactly this: slice from the start, then
    // re-normalise. Verified: retrieval ranking is identical at 2048 and 1024.
    if (values.length < EMBEDDING_DIMENSIONS) {
      throw new Error(
        `${this.model} returned ${values.length} dimensions, need at least ${EMBEDDING_DIMENSIONS} (ADR-0017)`,
      );
    }
    const truncated = values.slice(0, EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(truncated.reduce((sum, x) => sum + x * x, 0)) || 1;
    return truncated.map((x) => x / magnitude);
  }
}
