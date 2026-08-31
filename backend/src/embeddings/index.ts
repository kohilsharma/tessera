import { EmbeddingProvider } from "./EmbeddingProvider";
import { GeminiEmbeddingProvider } from "./GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider";
import { OpenAIEmbeddingProvider } from "./OpenAIEmbeddingProvider";

// ADR-0023: a hosted provider is the default once a key is configured; without
// one (every test run, and any dev machine that hasn't set one up) this falls
// back to the deterministic Mock — ADR-0003's "tests run with no API key" rule,
// extended to local dev too.
//
// EMBEDDING_PROVIDER picks between the hosted options; unset infers one from
// whichever key is present, so an existing Gemini-only .env keeps working.
export function createEmbeddingProvider(): EmbeddingProvider {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.EMBEDDING_API_KEY;
  const choice = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

  if (choice === "mock") return new MockEmbeddingProvider();
  if (choice === "openai" || (!choice && !geminiKey && openaiKey)) {
    if (!openaiKey) throw new Error("EMBEDDING_PROVIDER=openai needs EMBEDDING_API_KEY");
    return new OpenAIEmbeddingProvider(openaiKey);
  }
  if (choice === "gemini") {
    if (!geminiKey) throw new Error("EMBEDDING_PROVIDER=gemini needs GEMINI_API_KEY");
    return new GeminiEmbeddingProvider(geminiKey);
  }
  if (geminiKey) return new GeminiEmbeddingProvider(geminiKey);

  // The fallback keeps an offline clone demonstrable, but it silently downgrades
  // the semantic half of hybrid search to deterministic noise — which looks like
  // working search until you read the results. ADR-0023 makes hosted the
  // default, so a run that isn't on it should say so out loud. (Tests are the
  // one place the Mock is the intended provider, not a degraded one.)
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[embeddings] no embedding key set — falling back to the Mock provider. " +
        "Semantic search results are deterministic placeholders, not real similarity (ADR-0023).",
    );
  }
  return new MockEmbeddingProvider();
}
