import { EmbeddingProvider } from "./EmbeddingProvider";
import { GeminiEmbeddingProvider } from "./GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider";

// ADR-0023: gemini-embedding-001 is the default hosted provider once a key is
// configured; without one (every test run, and any dev machine that hasn't
// set one up) this falls back to the deterministic Mock — ADR-0003's "tests
// run with no API key" rule, extended to local dev too.
export function createEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) return new GeminiEmbeddingProvider(apiKey);
  // The fallback keeps an offline clone demonstrable, but it silently downgrades
  // the semantic half of hybrid search to deterministic noise — which looks like
  // working search until you read the results. ADR-0023 makes hosted the
  // default, so a run that isn't on it should say so out loud. (Tests are the
  // one place the Mock is the intended provider, not a degraded one.)
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[embeddings] GEMINI_API_KEY is unset — falling back to the Mock provider. " +
        "Semantic search results are deterministic placeholders, not real similarity (ADR-0023).",
    );
  }
  return new MockEmbeddingProvider();
}
