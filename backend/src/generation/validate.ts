import { claimTypesFor, type ClaimType } from "../entities/AnalysisClaim";
import type { GenerationFailureCode, GenerationLens, GenerationValidationResult } from "../entities/GenerationRun";

// ADR-0002's invariant, in code, below the prompt, non-tunable:
//
//   no displayed factual claim without a valid citation into its generation's
//   frozen EvidenceSet.
//
// Nothing here consults the model's own confidence, and nothing here can be
// configured — the only inputs are the answer, the run's Lens and the ids that were
// actually frozen. It holds whichever provider answered.
//
// #53 refuses the whole answer when any claim fails: partial acceptance, its floor,
// and the two repair attempts that come before a failure are #54. What #53 fixes is
// the shape of the measurement they will report through — `validationResult`.

export type ParsedClaim = { claimType: ClaimType; text: string; citations: string[] };

export type Validation =
  | { ok: true; claims: ParsedClaim[]; result: GenerationValidationResult }
  | { ok: false; failureCode: GenerationFailureCode; failureMessage: string; result: GenerationValidationResult };

const emptyResult = (): GenerationValidationResult => ({
  claimsReturned: 0,
  claimsAccepted: 0,
  claimsRejected: 0,
  unknownEvidenceIds: [],
  issues: [],
});

// Cheap models fence their JSON even when asked for an object, and some prepend a
// sentence — so take the outermost braces rather than trusting the whole response to
// parse. Same tolerance clustering/naming.ts applies, for the same reason.
function parseObject(raw: string): Record<string, unknown> | null {
  const object = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!object) return null;
  try {
    const parsed = JSON.parse(object);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// `a1`, ` A1 ` and `[A1]` are all the model naming A1. Normalising them is not
// leniency about the invariant — an id either is in the frozen set after this or it
// is not — it is refusing to fail a run over the syntax of a reference that is
// unambiguous. Frozen ids are A1…A10, so no two differ by case or padding.
function normaliseCitation(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").trim().toUpperCase();
}

export function validateAnalysis(raw: string, lens: GenerationLens, evidenceIds: Set<string>): Validation {
  const parsed = parseObject(raw);
  if (!parsed) {
    return {
      ok: false,
      failureCode: "unparseable_output",
      failureMessage: "The provider's answer was not a JSON object",
      result: emptyResult(),
    };
  }

  const returned = parsed.claims;
  const structural = (detail: string, claimIndex = -1): Validation => ({
    ok: false,
    failureCode: "schema_violation",
    failureMessage: detail,
    result: {
      ...emptyResult(),
      claimsReturned: Array.isArray(returned) ? returned.length : 0,
      claimsRejected: Array.isArray(returned) ? returned.length : 0,
      issues: [{ claimIndex, code: "schema_violation", detail }],
    },
  });

  if (!Array.isArray(returned) || returned.length === 0) return structural("No claims array in the answer");

  const permitted = claimTypesFor(lens);
  const claims: ParsedClaim[] = [];
  const issues: GenerationValidationResult["issues"] = [];
  const unknownEvidenceIds: string[] = [];

  for (const [claimIndex, entry] of returned.entries()) {
    const { text, claim_type: claimType, citations } = (entry ?? {}) as Record<string, unknown>;
    // A structural failure is not a claim to drop — there is nothing to keep — so it
    // ends the whole answer here rather than joining the issue list (ADR-0027).
    if (typeof text !== "string" || text.trim() === "") return structural("A claim carries no text", claimIndex);
    if (typeof claimType !== "string" || !(permitted as string[]).includes(claimType)) {
      return structural(`Claim type "${String(claimType)}" is outside the contract for lens ${lens}`, claimIndex);
    }
    if (!Array.isArray(citations) || citations.some((id) => typeof id !== "string")) {
      return structural("A claim's citations are not a list of evidence ids", claimIndex);
    }

    const cited = [...new Set((citations as string[]).map(normaliseCitation))].filter((id) => id !== "");
    if (cited.length === 0) {
      issues.push({ claimIndex, code: "claim_without_citation" });
      continue;
    }
    const unknown = cited.filter((id) => !evidenceIds.has(id));
    if (unknown.length > 0) {
      unknownEvidenceIds.push(...unknown);
      issues.push({ claimIndex, code: "unknown_evidence_id", detail: unknown.join(", ") });
      continue;
    }
    claims.push({ claimType: claimType as ClaimType, text: text.trim(), citations: cited });
  }

  const result: GenerationValidationResult = {
    claimsReturned: returned.length,
    claimsAccepted: claims.length,
    claimsRejected: returned.length - claims.length,
    unknownEvidenceIds: [...new Set(unknownEvidenceIds)],
    issues,
  };
  if (issues.length > 0) {
    return {
      ok: false,
      failureCode: "invalid_citations",
      failureMessage: issues.map((issue) => `claim ${issue.claimIndex}: ${issue.code}`).join("; "),
      result,
    };
  }
  return { ok: true, claims, result };
}
