import { MockSynthesisProvider } from "./MockSynthesisProvider";
import { OpenAICompatibleSynthesisProvider } from "./OpenAICompatibleSynthesisProvider";
import { SynthesisProvider } from "./SynthesisProvider";

// Mirrors createEmbeddingProvider(): SYNTHESIS_PROVIDER picks explicitly,
// otherwise a key implies the hosted provider and its absence implies the Mock
// (ADR-0003 — tests and any machine without a key still run).
//
// "openai" here means the *protocol*, not the vendor. NVIDIA, Gemini (via
// https://generativelanguage.googleapis.com/v1beta/openai), DeepSeek and any
// gateway all speak it, so they are all reachable by setting SYNTHESIS_API_BASE
// and SYNTHESIS_MODEL — no new code (ADR-0003: no hardcoded model ids or hosts).
export function createSynthesisProvider(): SynthesisProvider {
  const apiKey = process.env.SYNTHESIS_API_KEY;
  const choice = process.env.SYNTHESIS_PROVIDER?.trim().toLowerCase();

  if (choice === "mock") return new MockSynthesisProvider();
  if (choice === "openai") {
    if (!apiKey) throw new Error("SYNTHESIS_PROVIDER=openai needs SYNTHESIS_API_KEY");
    return new OpenAICompatibleSynthesisProvider(apiKey);
  }
  if (apiKey) return new OpenAICompatibleSynthesisProvider(apiKey);

  // Unlike embeddings, a Mock synthesis is obvious the moment you read the
  // output, so this warns for symmetry rather than to prevent a silent demo.
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[synthesis] SYNTHESIS_API_KEY is unset — using the Mock provider (ADR-0003).",
    );
  }
  return new MockSynthesisProvider();
}

export type { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";
