import { GENERATION_LENSES, type GenerationLens } from "../entities/GenerationRun";
import type { UserRole } from "../entities/User";

// v3 §16.2's evidence bounds, "initial defaults, configurable". Fixed constants
// rather than env knobs: unlike clustering's similarity threshold these are not
// calibration — they are the shape of a prompt and the shape of a claim about
// coverage, and a demo machine that quietly raised the cap to 40 would be paying
// for a different product than the one described.
export const MAX_EVIDENCE_ARTICLES = 10;
export const MAX_ARTICLES_PER_PUBLISHER = 2;

// ADR-0027's wire-copy floor. Ingestion keys duplicate detection on title +
// *publisher* + date, so one wire report republished by five outlets is five Articles
// by design — and they cluster together trivially, sit closest to a centroid they
// themselves define, and pass the ≤2-per-publisher cap five times over. Above this
// cosine similarity to an already-selected member a candidate is the same report under
// another masthead, so it is skipped and `distinctPublisherCount` goes on counting
// independent reporting, which is what the minimum below assumes it counts.
//
// High, and not an env knob: this is a statement about identical text, not
// calibration. Independent reporting on one event lands well below it; wire copy
// lands just under 1.
export const NEAR_DUPLICATE_SIMILARITY = 0.97;

// v3 §16.2's "minimum 2 distinct Publishers for comparative synthesis". Checked
// after the collapse above, and before anything is frozen or paid for: an analysis
// of how outlets compare needs two outlets.
export const MIN_DISTINCT_PUBLISHERS = 2;

// ADR-0027's floor under partial acceptance. Dropping an invalid claim keeps the
// invariant ("no *displayed* claim without a valid citation") without throwing away
// four good claims for one bad one — and this is what stops that degrading into "we
// showed whatever survived".
export const MIN_SURVIVING_CLAIMS = 2;

// Repair, not escalation (ADR-0027): two more attempts, each re-prompting with the
// specific validation error, then a stated unavailable state. There is no stronger
// model to climb to — ADR-0025 found no dependable one on a free tier — so a ladder
// would be a cost path for a capability we do not have.
export const MAX_REPAIR_ATTEMPTS = 2;

// ADR-0027's ~1500-character excerpt. Long enough to carry a lede and its
// qualifications, short enough that ten of them fit a cheap model's context.
export const EXCERPT_CHARS = 1500;

// The version label of the *shipped* PromptTemplate — the row CreatePromptTemplates
// inserts as current, and the fallback if no row is current at all (#57). Recorded on
// every run and part of the reuse key, so activating a different version invalidates
// every cached analysis by design.
//
// Since #57 the prompt is data, so its version is data too: changing what prompt.ts
// asks for means bumping this *and* shipping a migration that inserts and activates a
// row carrying the new label. The template test in tests/generation.test.ts asserts a
// migrated database's current version is this constant, so bumping one without the
// other fails the suite rather than silently serving cached analyses from the old
// prompt.
export const PROMPT_VERSION = "2026-09-03";

// The ceiling on a tuned claim count. Not calibration: one response carries the
// answer, and an Admin asking for forty claims would get output truncated at
// maxTokens — a structural failure on every run rather than a more thorough analysis.
// The floor is MIN_SURVIVING_CLAIMS above, which is validation's, so a tuned prompt
// can never ask for fewer claims than a publishable run needs.
export const MAX_REQUESTED_CLAIMS = 8;

// How much tuned free text a PromptTemplate may carry per field. A clause, not an
// essay: these sit among the contract's own instructions, and the evidence has to fit
// the same context window.
export const TUNED_TEXT_MAX_LENGTH = 240;

// The whole request's budget for model calls, repairs included — not per attempt.
// Generation is synchronous, so this is how long a reader's request can hang before
// it is answered with a stated failure, and three attempts at 60 seconds each would
// make that promise a lie.
export const SYNTHESIS_TIMEOUT_MS = 60_000;

// ADR-0027: the Lens is derived from the caller's role, not chosen by them — a
// Student and an Investor asking about the same Story is the whole of how ADR-0004's
// "roles differ in the data they get" is met. An Admin belongs to neither audience
// and has to say which one they are looking at, which is why this returns null for
// them rather than picking one.
export function lensForRole(role: UserRole): GenerationLens | null {
  if (role === "student") return "student_context";
  if (role === "investor") return "investor_implication";
  return null;
}

export function isGenerationLens(value: unknown): value is GenerationLens {
  return typeof value === "string" && (GENERATION_LENSES as readonly string[]).includes(value);
}
