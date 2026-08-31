import type { ClaimEvidenceRelationship } from "../entities/ClaimEvidence";
import { claimTypesFor, type ClaimType } from "../entities/AnalysisClaim";
import type { GenerationFailureCode, GenerationLens, GenerationValidationResult } from "../entities/GenerationRun";
import { MIN_SURVIVING_CLAIMS } from "./config";

// ADR-0002's invariant, in code, below the prompt, non-tunable:
//
//   no displayed factual claim without a valid citation into its generation's
//   frozen EvidenceSet.
//
// Nothing here consults the model's own confidence, and nothing here can be
// configured — the only inputs are the answer, the run's Lens, what was actually
// frozen and which rung that evidence sits on. It holds whichever provider answered.
//
// #54 splits the two ways an answer can be wrong. A *claim* that fails is dropped and
// recorded (partial acceptance, ADR-0027): one bad claim among four good ones costs the
// claim, not the analysis. A *structural* failure — output that is not JSON, or JSON
// that is not the contract — fails the whole answer, because there is nothing to keep.
// Either way, an answer this refuses is re-prompted with the reason before the run is
// given up on; the repair loop is runGeneration's.

export type ParsedCitation = { evidenceId: string; relationship: ClaimEvidenceRelationship };
export type ParsedClaim = { claimType: ClaimType; text: string; citations: ParsedCitation[] };

// The frozen set as validation needs it: which ids exist, and which Publisher each one
// resolves to. The Publisher is what makes a contradiction checkable — "the reporting
// disagrees" is a claim about two newsrooms, not about two paragraphs.
export type FrozenEvidence = Map<string, string>;

export type Validation =
  | { ok: true; claims: ParsedClaim[]; result: GenerationValidationResult }
  | { ok: false; failureCode: GenerationFailureCode; failureMessage: string; result: GenerationValidationResult };

const emptyResult = (): GenerationValidationResult => ({
  claimsReturned: 0,
  claimsAccepted: 0,
  claimsRejected: 0,
  unknownEvidenceIds: [],
  repairAttempts: 0,
  issues: [],
});

// v3 §16.6, enforced rather than requested. An excerpt is not the report: a detail that
// is absent from 1500 characters may be in the fifth paragraph, so "publisher X omitted
// Y" is a claim about the corpus that the corpus cannot support. Only checked below full
// text — with the whole permitted report in hand it is a sayable claim, carefully framed.
//
// It is defence in depth under a prompt that already asks for the constrained wording
// (v3 §20.5 — "simple keyword matching is not the sole control"), and the three wordings
// §16.6 recommends ("not found in the available excerpt", "not present in the material
// available from", "coverage difference within the selected evidence set") all pass it.
//
// ponytail: a phrase list cannot tell a publisher from an actor in the story, so "the
// central bank ignored calls for a cut" is dropped like an omission claim would be. The
// bias is deliberate — a dropped claim is recorded and the analysis usually still stands,
// while an overclaim about a publisher's coverage is on screen — but it is a naive
// heuristic, and v3 §20.5's item 4 (a classification pass over the claim) is the upgrade.
const OMISSION_PHRASES: RegExp[] = [
  /\bomit(?:s|ted|ting)?\b/i,
  /\bomission\b/i,
  /\bfail(?:s|ed)? to (?:mention|report|note|cover)\b/i,
  /\b(?:does|do|did) not (?:mention|report|note|cover|discuss)\b/i,
  /\bmakes no mention\b/i,
  /\bno (?:mention|coverage) of\b/i,
  /\bignor\w+\b/i,
  /\bleaves out\b/i,
  /\bsilent on\b/i,
  /\bsays nothing about\b/i,
  /\babsent from\b/i,
  /\bmissing from\b/i,
  /\boverlook(?:s|ed)?\b/i,
  /\bneglect(?:s|ed)? to\b/i,
];

// v3 §20.5's deterministic prohibited-pattern check. Advice-shaped, not finance-shaped:
// "the company will buy the plant" is ordinary reporting, and refusing the word would
// refuse the story. What is refused is a recommendation *to the reader* to trade, a bare
// imperative to trade, and a numeric target — under every Lens, because advice in a
// student's analysis is no more permitted than advice in an investor's.
//
// ponytail: the same naive-heuristic ceiling as above, in the other direction — reported
// advice ("the board recommended shareholders hold") reads like asserted advice and is
// dropped, and a target phrased in a way not listed here passes. The prompt forbids both
// as well, and §20.5's classification pass is the upgrade.
const INVESTMENT_ADVICE_PHRASES: RegExp[] = [
  /\b(?:investors?|shareholders?|readers?|traders?|holders?|you|we)\b[^.]{0,40}\b(?:should|must|ought to)\b[^.]{0,40}\b(?:buy|sell|short|hold|invest|divest|exit|add|trim)\b/i,
  /\b(?:recommend|advis|urg)\w*\b[^.]{0,40}\b(?:buy|sell|short|hold|invest|divest|exit)\b/i,
  // A bare imperative, which is how a cheap model writes advice when it drops the
  // subject: "Sell the position ahead of the decision."
  /^(?:buy|sell|short|hold|divest|exit)\b/i,
  /\b(?:price|share|profit)\s+target\b/i,
  /\btarget price\b/i,
  /\bPT\s*\$/,
  /\bfair value (?:at|of)\s*\$/i,
  /\b\d+\s*% (?:upside|downside)\b/i,
  /\bentry point\b/i,
  /\bstrong (?:buy|sell)\b/i,
];

// Why a claim was dropped, worded so the same string can be shown to an Admin and fed
// back to the model as the repair instruction.
const ISSUE_GUIDANCE: Record<string, string> = {
  claim_without_citation: "cited no evidence id",
  unknown_evidence_id: "cited an evidence id that was not in the reporting provided",
  omission_language: "claimed a publisher omitted something, which an excerpt cannot support",
  prohibited_investor_language: "gave investment advice or named a price target",
  unsupported_contradiction: "was a contradiction without distinct supporting and contradicting Publishers",
};

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

export function validateAnalysis(
  raw: string,
  lens: GenerationLens,
  evidence: FrozenEvidence,
  { fullPermittedText }: { fullPermittedText: boolean },
): Validation {
  const parsed = parseObject(raw);
  if (!parsed) {
    return {
      ok: false,
      failureCode: "unparseable_output",
      failureMessage: "The answer was not a JSON object",
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
    const { text, claim_type: claimType, citations, sides } = (entry ?? {}) as Record<string, unknown>;
    // A structural failure is not a claim to drop — there is nothing to keep — so it
    // ends the whole answer here rather than joining the issue list (ADR-0027).
    if (typeof text !== "string" || text.trim() === "") return structural("A claim carries no text", claimIndex);
    if (typeof claimType !== "string" || !(permitted as string[]).includes(claimType)) {
      return structural(`Claim type "${String(claimType)}" is outside the contract for lens ${lens}`, claimIndex);
    }

    const drop = (code: string, detail?: string): void => {
      issues.push({ claimIndex, code, ...(detail ? { detail } : {}) });
    };

    let parsedCitations: ParsedCitation[];
    if (claimType === "contradiction") {
      const sideObject = sides !== null && typeof sides === "object" && !Array.isArray(sides)
        ? (sides as Record<string, unknown>)
        : null;
      const supports = sideObject?.supports;
      const contradicts = sideObject?.contradicts;
      if (
        !Array.isArray(supports) ||
        supports.some((id) => typeof id !== "string") ||
        !Array.isArray(contradicts) ||
        contradicts.some((id) => typeof id !== "string")
      ) {
        drop(!fullPermittedText && OMISSION_PHRASES.some((phrase) => phrase.test(text))
          ? "omission_language"
          : "unsupported_contradiction");
        continue;
      }
      const supportedIds = [...new Set((supports as string[]).map(normaliseCitation))].filter((id) => id !== "");
      const contradictedIds = [...new Set((contradicts as string[]).map(normaliseCitation))].filter((id) => id !== "");
      if (
        supportedIds.length === 0 ||
        contradictedIds.length === 0 ||
        supportedIds.some((id) => contradictedIds.includes(id))
      ) {
        drop("unsupported_contradiction");
        continue;
      }
      parsedCitations = [
        ...supportedIds.map((evidenceId) => ({ evidenceId, relationship: "supports" as const })),
        ...contradictedIds.map((evidenceId) => ({ evidenceId, relationship: "contradicts" as const })),
      ];
    } else {
      if (!Array.isArray(citations) || citations.some((id) => typeof id !== "string")) {
        return structural("A claim's citations are not a list of evidence ids", claimIndex);
      }
      parsedCitations = [...new Set((citations as string[]).map(normaliseCitation))]
        .filter((evidenceId) => evidenceId !== "")
        .map((evidenceId) => ({ evidenceId, relationship: "supports" as const }));
    }

    if (parsedCitations.length === 0) {
      drop("claim_without_citation");
      continue;
    }
    const unknown = parsedCitations.map((citation) => citation.evidenceId).filter((id) => !evidence.has(id));
    if (unknown.length > 0) {
      unknownEvidenceIds.push(...unknown);
      drop("unknown_evidence_id", unknown.join(", "));
      continue;
    }
    if (!fullPermittedText && OMISSION_PHRASES.some((phrase) => phrase.test(text))) {
      drop("omission_language");
      continue;
    }
    if (INVESTMENT_ADVICE_PHRASES.some((phrase) => phrase.test(text))) {
      drop("prohibited_investor_language");
      continue;
    }
    if (claimType === "contradiction") {
      const supportingPublishers = new Set(
        parsedCitations
          .filter((citation) => citation.relationship === "supports")
          .map((citation) => evidence.get(citation.evidenceId)!),
      );
      const contradictingPublishers = new Set(
        parsedCitations
          .filter((citation) => citation.relationship === "contradicts")
          .map((citation) => evidence.get(citation.evidenceId)!),
      );
      // A Publisher cannot be both sides of an inter-Publisher disagreement. Requiring
      // disjoint non-empty sets also implies the existing two-Publisher minimum.
      if ([...supportingPublishers].some((publisherId) => contradictingPublishers.has(publisherId))) {
        drop("unsupported_contradiction");
        continue;
      }
    }
    claims.push({ claimType: claimType as ClaimType, text: text.trim(), citations: parsedCitations });
  }

  const result: GenerationValidationResult = {
    claimsReturned: returned.length,
    claimsAccepted: claims.length,
    claimsRejected: returned.length - claims.length,
    unknownEvidenceIds: [...new Set(unknownEvidenceIds)],
    repairAttempts: 0,
    issues,
  };

  // ADR-0027's floor. Above it, a dropped claim costs itself and the analysis stands;
  // below it, "we showed whatever survived" is not an analysis of how outlets compared,
  // so the reader is shown a stated unavailable state instead.
  //
  // Two conditions, exactly as ADR-0027 states them. Note what that leaves open: the
  // run's *Lens* claim is not one of them, so an Investor analysis whose only
  // investor_implication claim was dropped completes as two consensus claims — and reuse
  // then serves that as the Investor reading of the Story until the evidence changes.
  // Adding the Lens claim to the floor is a policy change to make in the ADR, not here.
  const shortfall: string[] = [];
  if (claims.length < MIN_SURVIVING_CLAIMS) {
    shortfall.push(`only ${claims.length} of ${returned.length} claims could be used, and at least ${MIN_SURVIVING_CLAIMS} are needed`);
  }
  if (!claims.some((claim) => claim.claimType === "consensus")) {
    shortfall.push("no consensus claim survived, and an analysis needs at least one");
  }
  if (shortfall.length > 0) {
    const rejections = issues.map(
      (issue) =>
        `claim ${issue.claimIndex + 1} ${ISSUE_GUIDANCE[issue.code] ?? issue.code}` +
        (issue.detail ? ` (${issue.detail})` : ""),
    );
    // Two honest readings of one refusal, and the reader is told which. A citation that
    // did not resolve is ADR-0002's invariant refusing to be displayed; a claim refused
    // on rights, advice or contradiction grounds is not a citation problem, and calling
    // it one would misdescribe the run *and* pollute the citation pass-rate the eval
    // harness reads off this column.
    const citationRefusal = issues.some(
      (issue) => issue.code === "claim_without_citation" || issue.code === "unknown_evidence_id",
    );
    return {
      ok: false,
      failureCode: citationRefusal ? "invalid_citations" : "below_claim_floor",
      failureMessage: [...rejections, ...shortfall].join("; "),
      result,
    };
  }
  return { ok: true, claims, result };
}
