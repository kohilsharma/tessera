import { EmbeddingProvider } from "./EmbeddingProvider";
import { GeminiEmbeddingProvider } from "./GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider";

// ADR-0023: gemini-embedding-001 is the default hosted provider once a key is
// configured; without one (every test run, and any dev machine that hasn't
// set one up) this falls back to the deterministic Mock — ADR-0003's "tests
// run with no API key" rule, extended to local dev too.
export function createEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? new GeminiEmbeddingProvider(apiKey) : new MockEmbeddingProvider();
}
