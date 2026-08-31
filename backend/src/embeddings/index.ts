import { EmbeddingProvider } from "./EmbeddingProvider";
import { GeminiEmbeddingProvider } from "./GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider";
import { EmbeddingInputStyle, OpenAIEmbeddingProvider } from "./OpenAIEmbeddingProvider";

type EmbeddingProviderChoice = "mock" | "openai" | "gemini";

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the selected embedding provider`);
  return value;
}

function explicitChoice(): EmbeddingProviderChoice | undefined {
  const value = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "mock" || value === "openai" || value === "gemini") return value;
  throw new Error(`EMBEDDING_PROVIDER must be mock, openai, or gemini; got "${value}"`);
}

function inputStyle(): EmbeddingInputStyle {
  const value = process.env.EMBEDDING_INPUT_STYLE?.trim() || "prefix";
  if (value === "prefix" || value === "input_type") return value;
  throw new Error(`EMBEDDING_INPUT_STYLE must be prefix or input_type; got "${value}"`);
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const openaiKey = process.env.EMBEDDING_API_KEY?.trim();
  const choice = explicitChoice() ?? (geminiKey ? "gemini" : openaiKey ? "openai" : "mock");

  if (choice === "mock") {
    if (process.env.NODE_ENV !== "test" && !process.env.EMBEDDING_PROVIDER) {
      console.warn(
        "[embeddings] no embedding key set — using the Mock provider; semantic results are placeholders.",
      );
    }
    return new MockEmbeddingProvider();
  }

  if (choice === "gemini") {
    if (!geminiKey) throw new Error("EMBEDDING_PROVIDER=gemini needs GEMINI_API_KEY");
    return new GeminiEmbeddingProvider(geminiKey, required("EMBEDDING_MODEL"));
  }
  if (!openaiKey) throw new Error("EMBEDDING_PROVIDER=openai needs EMBEDDING_API_KEY");
  return new OpenAIEmbeddingProvider(
    openaiKey,
    required("EMBEDDING_MODEL"),
    required("EMBEDDING_API_BASE"),
    inputStyle(),
  );
}
