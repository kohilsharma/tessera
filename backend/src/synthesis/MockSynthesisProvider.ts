import { SynthesisProvider, SynthesisRequest } from "./SynthesisProvider";

// ADR-0003 requires a deterministic Mock so the whole suite runs with no API
// key. It answers in the shape the caller asked for — a JSON object when
// `json` is set — so the validate-and-repair loop can be tested against a
// provider that never varies and never bills.
export class MockSynthesisProvider implements SynthesisProvider {
  async complete(request: SynthesisRequest): Promise<string> {
    if (!request.json) return `[mock synthesis] ${request.prompt.slice(0, 120)}`;
    // Echoing the evidence ids found in the prompt keeps the Mock honest about
    // ADR-0002's invariant: a claim carries citations, or it is not a claim.
    const ids = [...request.prompt.matchAll(/\[([a-z0-9-]{1,64})\]/gi)].map((m) => m[1]);
    return JSON.stringify({
      claims: [
        {
          text: "[mock synthesis] deterministic claim over the frozen evidence set.",
          claim_type: "factual",
          citations: ids.slice(0, 2),
        },
      ],
    });
  }
}
