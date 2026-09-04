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
  // A stable label for *what* is being asked, naming every caller including the
  // flagship. Real providers only log it; the Mock needs it to answer in the shape the
  // caller expects, since `json` alone says nothing about which JSON. A closed union, so
  // a typo is a compile error rather than synthesis-shaped output arriving where a Story
  // name was expected. Optional because a provider test asks for nothing in particular;
  // absent reads as "synthesis".
  task?: "synthesis" | "story_name" | "flashcard_questions" | "flashcard_cards";
  // Total budget for the call including retries. A hung endpoint would otherwise
  // hold the worker forever: concurrency is 1, so one stuck request stalls the
  // whole queue (#42).
  timeoutMs?: number;
}

export interface SynthesisProvider {
  complete(request: SynthesisRequest): Promise<string>;
}
