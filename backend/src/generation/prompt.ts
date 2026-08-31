import { CORE_CLAIM_TYPES } from "../entities/AnalysisClaim";
import type { GenerationLens } from "../entities/GenerationRun";
import type { SelectedEvidence } from "./evidence";
import { withoutCitationBrackets } from "./evidence";

// ADR-0027: the prompt is a versioned code constant (config.ts's PROMPT_VERSION),
// and nothing it says is load-bearing. Everything that makes a cheap model's answer
// safe to display is enforced in validate.ts, below this — so an Admin tuning a
// PromptTemplate later in the phase cannot reach the check that makes tuning safe.

const SYSTEM =
  "You are an analyst for a news intelligence system. You compare how several publishers reported one " +
  "event, and you cite the reporting you used. Answer with a JSON object only.";

// What each Lens asks for. One sentence each, because a Lens is one claim type — the
// difference between a Student's analysis and an Investor's is what that claim is
// about, not a different pipeline (ADR-0004, ADR-0021).
const LENS_INSTRUCTION: Record<GenerationLens, string> = {
  student_context:
    "student_context: the background a newcomer to this story needs in order to follow it — what the " +
    "terms mean, why it matters, what came before.",
  investor_implication:
    "investor_implication: what this reporting implies for a business or market read, stated as an " +
    "implication of the evidence and never as advice to buy, sell or hold.",
};

// Evidence first, instructions after. Two reasons: a cheap model attends to what it
// was shown before what it was asked, and MockSynthesisProvider reads the evidence
// ids back out of the prompt by taking the first bracketed tokens it finds — so the
// no-key path depends on `[A1]` appearing before any other bracket. The end-to-end
// Mock test in tests/generation.test.ts is what fails if that ordering drifts.
//
// The excerpts go out whatever the Publisher's Terms Class says, which is ADR-0003's
// documented exception to bodies staying internal (ADR-0018): synthesis evidence text
// goes to the paid, contractually no-training provider. Serving that text back to a
// reader is a separate decision, made per Publisher, in runGeneration's view.
export function buildAnalysisPrompt(evidence: SelectedEvidence[], lens: GenerationLens): string {
  const blocks = evidence.map(
    (row) =>
      `[${row.evidenceId}] ${withoutCitationBrackets(row.publisherName)} — ` +
      `"${withoutCitationBrackets(row.title)}" ` +
      `(${row.publishedAt.toISOString().slice(0, 10)})\n${row.excerpt}`,
  );
  const claimTypes = [...CORE_CLAIM_TYPES, lens].join(", ");
  return [
    `Reporting on one story, from ${new Set(evidence.map((row) => row.publisherName)).size} publisher(s):`,
    "",
    ...blocks,
    "",
    // No bracketed word anywhere below, for the reason above: the Mock reads the
    // first two bracketed tokens as evidence ids, so `[string]` in a schema sketch
    // would become a citation nothing can resolve on a one-Article set.
    'Answer with a JSON object {"claims": [...]}, where each claim is ' +
      '{"text": string, "claim_type": string, "citations": array of evidence ids}.',
    `claim_type must be one of: ${claimTypes}.`,
    `consensus: something the reporting agrees on. source_specific: something only one publisher reports. ` +
      `contradiction: a point where the reporting disagrees.`,
    LENS_INSTRUCTION[lens],
    "citations must be evidence ids from the reporting above, written without brackets, for example A1.",
    "Every claim must cite at least one evidence id, and may cite only ids listed above.",
    "State nothing that the cited reporting does not support.",
    `Return between 3 and 6 claims: at least one consensus claim and exactly one ${lens} claim.`,
  ].join("\n");
}

export function analysisRequest(evidence: SelectedEvidence[], lens: GenerationLens) {
  return { system: SYSTEM, prompt: buildAnalysisPrompt(evidence, lens), json: true, maxTokens: 1200 };
}
