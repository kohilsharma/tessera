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

export function createSynthesisProvider(): SynthesisProvider {
  const apiKey = process.env.SYNTHESIS_API_KEY?.trim();
  const choice = explicitChoice() ?? (apiKey ? "openai" : "mock");
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
