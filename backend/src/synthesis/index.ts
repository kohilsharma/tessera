import { MockSynthesisProvider } from "./MockSynthesisProvider";
import { OpenAICompatibleSynthesisProvider } from "./OpenAICompatibleSynthesisProvider";
import { SynthesisProvider } from "./SynthesisProvider";

type SynthesisProviderChoice = "mock" | "openai";

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the selected synthesis provider`);
  return value;
}

function explicitChoice(): SynthesisProviderChoice | undefined {
  const value = process.env.SYNTHESIS_PROVIDER?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "mock" || value === "openai") return value;
  throw new Error(`SYNTHESIS_PROVIDER must be mock or openai; got "${value}"`);
}

function resolveChoice(): SynthesisProviderChoice {
  return explicitChoice() ?? (process.env.SYNTHESIS_API_KEY?.trim() ? "openai" : "mock");
}

// Which provider a call made right now would reach, as one short label: `mock`, or
// the configured model id. Recorded on every GenerationRun and part of ADR-0027's
// reuse key (#53) — so an analysis the Mock wrote is never served after a key is
// configured, and "which model saw this Publisher's body text" is answerable from the
// row (the ADR-0003 exception that lets it go there at all).
export function synthesisProviderLabel(): string {
  if (resolveChoice() === "mock") return "mock";
  return process.env.SYNTHESIS_MODEL?.trim() || "openai";
}

export function createSynthesisProvider(): SynthesisProvider {
  const apiKey = process.env.SYNTHESIS_API_KEY?.trim();
  const choice = resolveChoice();
  if (choice === "mock") return new MockSynthesisProvider();
  if (!apiKey) throw new Error("SYNTHESIS_PROVIDER=openai needs SYNTHESIS_API_KEY");
  return new OpenAICompatibleSynthesisProvider(
    apiKey,
    required("SYNTHESIS_MODEL"),
    required("SYNTHESIS_API_BASE"),
    required("SYNTHESIS_ALLOWED_ORIGIN"),
  );
}

export type { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";
