# 10. Flagship generation contract: evidence freeze, 3 claim types + lens, deterministic validation

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0002 (flagship), ADR-0003 (providers)
Refines/corrects: v3 §9.5–9.6, §15.3, §15.5, §16

## Context

The flagship (ADR-0002) is frozen-evidence cited synthesis. Its defensibility rests on one
invariant, not on breadth of output. v3 §9.6/§16.4 specify EIGHT claim types (consensus,
source_specific, contradiction, coverage_difference, unresolved_question, student_context,
investor_implication, caveat) plus timeline nodes in one structured generation. Every claim
type is validation surface + output complexity we ask a *cheap* model (ADR-0003) to produce
reliably — more types → more schema failures → more repair/escalation → slower, flakier.

The citation invariant is equally provable with 3 claim types as with 8. The extra 5 are
surface area, not differentiation.

Also: v3 §15.3 mandates the "OpenAI Responses API + strict JSON Schema." That contradicts
ADR-0003 (cheap OpenAI-*compatible* Chat Completions, no vendor schema guarantee). Corrected
here.

## Decision

**The invariant (non-negotiable, the viva centerpiece):**
> No displayed factual claim without a valid citation into its generation's frozen EvidenceSet.
Enforced in *backend* code, independent of model.

**Evidence freeze (keep v3 §16.3 verbatim):** each EvidenceSet stores, per article, a stable
evidence ID (`A1`…), the article content hash, the exact excerpt snapshot, selection reason,
and source rank. Later article edits never change a past generation's basis.

**Claim contract (reduced from 8 to 3 + lens):**
- `consensus`, `source_specific`, `contradiction` — the three core types.
- Plus exactly one role lens per generation: `student_context` OR `investor_implication`.
- Deferred behind the same schema: coverage_difference, unresolved_question, caveat, timeline.

**Generation transport (corrects §15.3):** OpenAI-compatible **Chat Completions** + JSON
output + **our own validate-and-repair loop** (ADR-0003). NOT the OpenAI Responses API and
NOT a vendor strict-schema guarantee.

**Deterministic escalation (keep v3 §15.5):** escalate on deterministic failures only —
refusal, schema failure, citation ID outside EvidenceSet, required claim without evidence,
prohibited investor language, insufficient distinct publishers, validation score below
threshold. NOT on model self-reported confidence. If escalation also fails: mark
flagged/failed and show a safe "unavailable" state. Never silently serve invalid intelligence.

**Evidence bounds (keep v3 §16.2 defaults, configurable):** ≤10 articles/set, ≤2/publisher,
≥2 distinct publishers for comparative synthesis, include earliest+latest.

## Consequences

- Reliable cheap-model output; bounded validation code; same invariant to defend.
- GenerationRun/EvidenceSet/AnalysisClaim/ClaimEvidence tables kept as in v3 §9.5–9.6 (the
  claimType enum simply starts with fewer values — additive later, no migration pain).
- Timeline (§9.7) is not in the graded flagship; see module-cut ADR.
