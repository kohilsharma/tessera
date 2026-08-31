// ADR-0003: services select a model by env config and never hardcode a model id.
// The interface is deliberately narrow — one call, text in, text out — because
// everything that makes Tessera's synthesis trustworthy (the frozen EvidenceSet,
// the validate-and-repair loop, citation validation) is enforced *above* this
// seam, in our code, where it holds no matter which model answers (ADR-0002).

export interface SynthesisRequest {
  prompt: string;
  system?: string;
  // Ask the endpoint for a JSON object. ADR-0003 does not trust this to
  // guarantee schema conformance — the repair loop above still validates.
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface SynthesisProvider {
  complete(request: SynthesisRequest): Promise<string>;
}
