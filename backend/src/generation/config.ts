import { GENERATION_LENSES, type GenerationLens } from "../entities/GenerationRun";
import type { UserRole } from "../entities/User";

// v3 §16.2's evidence bounds, "initial defaults, configurable". Fixed constants
// rather than env knobs: unlike clustering's similarity threshold these are not
// calibration — they are the shape of a prompt and the shape of a claim about
// coverage, and a demo machine that quietly raised the cap to 40 would be paying
// for a different product than the one described.
export const MAX_EVIDENCE_ARTICLES = 10;
export const MAX_ARTICLES_PER_PUBLISHER = 2;

// ADR-0027's ~1500-character excerpt. Long enough to carry a lede and its
// qualifications, short enough that ten of them fit a cheap model's context.
export const EXCERPT_CHARS = 1500;

// ADR-0027: a versioned code constant, recorded on every run, and the third part of
// the reuse key — so bumping it invalidates every cached analysis by design. Bump
// it whenever prompt.ts changes what it asks for.
export const PROMPT_VERSION = "2026-09-01";

// The whole call including retries. Generation is synchronous, so this is also how
// long a reader's request can hang before it is answered with a stated failure.
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
