# 27. Generation shape: deterministic evidence, partial claim acceptance, no escalation ladder

Date: 2026-08-31
Status: Accepted
Depends on: ADR-0002 (the invariant), ADR-0010 (generation contract), ADR-0024 (text ladder),
ADR-0025 (providers), ADR-0026 (clustering)
Refines: ADR-0010 — the contract stands; this settles what it left open.

## Context

ADR-0010 fixed the invariant, the claim contract (3 types + one lens), the evidence bounds
and the escalation triggers. Building it surfaced four questions it does not answer: how
evidence is *ranked* and what exactly is frozen; what "escalate" means concretely; what
happens when four claims validate and one does not; and where the mixed-rung wording rule
(ADR-0024) is enforced.

## Decision

- **A GenerationRun belongs to the Story**, one current run per lens, so synthesis is shared
  and paid for once. An IntelligenceBrief references a run through a nullable
  `generationRunId` — which is what "a Brief freezes a specific generation" means, and why a
  Brief keeps its claims after its Story regenerates.
- **Triggered by a user** on Story detail; the **Lens** is derived from the caller's role
  (Student → `student_context`, Investor → `investor_implication`), an Admin choosing
  explicitly. Generating for every new Story spends money on Stories nobody opens.
- **Reuse is keyed on a composite content hash** — the member Articles' content hashes, the
  lens, and the prompt version. This is the implementation of the "cache LLM calls by
  content_hash" invariant. A timestamp comparison would miss an Article whose text was
  enriched in place without any new member joining.
- **Selection is deterministic**: rank by distance to the Story centroid, apply ADR-0010's
  bounds (≤10 Articles, ≤2 per Publisher, earliest and latest forced in), exclude pending
  assignments. No model participates in choosing evidence — evidence a model selected is
  evidence nobody can re-derive, which defeats freezing.
- **Near-duplicates are collapsed inside the EvidenceSet, not in the corpus.** Ingestion
  keys duplicate detection on title + *publisher* + date, so one wire report republished by
  five outlets is five Articles by design — and they cluster together trivially, sit closest
  to a centroid they themselves define, and pass the ≤2-per-publisher cap five times over.
  The resulting `consensus` claim would cite five publishers that are one newsroom, with
  every citation resolving and every hash matching. So after ranking, a candidate whose
  similarity to an already-selected member exceeds a high floor is skipped. The rows stay —
  syndication reach is signal — but `distinctPublisherCount` counts independent reporting,
  which is what ADR-0010's "minimum 2 distinct publishers" assumes it counts.

- **The frozen row** stores a deterministic ~1500-character excerpt and an
  `articleContentHash` over the **full** `analysisText`, revalidated at persist. Hashing only
  the excerpt would miss a body that changed underneath it.
- **`EvidenceSet.dataMode` is the weakest rung among its members** (ADR-0024). Below
  `licensed_full_text` the prompt carries v3 §16.6's wording, backed by phrase-level
  rejection of omission and prohibited-investor language in validation — prompt-only
  enforcement makes a cheap model's carelessness into a rights-adjacent overclaim on screen.
- **Repair, not escalation.** Two repair attempts, each re-prompting with the specific
  validation error, then `failed` and a safe unavailable state.
  `SYNTHESIS_ESCALATION_MODEL` is read and unset by default: ADR-0025's measurements found
  no dependable stronger rung on a free tier, and a ladder that cannot be populated is a
  cost path and a branch to test for a capability we do not have.
- **Partial acceptance.** An invalid claim is **dropped and recorded** in `validationResult`,
  not fatal to its run, with a floor: at least two surviving claims including at least one
  `consensus`, or the run fails. The invariant is "no *displayed* claim without a valid
  citation", which permits dropping; the floor is what stops that degrading into "we showed
  whatever survived". **Structural failures — unparseable JSON, schema violation — fail the
  whole run**, because there is no claim to drop.
- **The prompt is a versioned code constant** whose version is recorded on every run. The
  PromptTemplate table and its Admin CRUD (ADR-0021) arrive later in the phase; the recorded
  version means no history is lost when they do.

## Consequences

- `validationResult` accumulates a per-run measurement of how often the model cites evidence
  that does not exist — which is exactly the generation pass-rate the Phase 5 eval harness
  wants (ADR-0011), collected from day one as a side effect of validating.
- Validation is testable with no model: captured real failures become fixtures, one per
  failure mode, with a single live check behind `SYNTHESIS_LIVE_SMOKE=1` (the pattern
  `GDELT_LIVE_SMOKE=1` already established).
- Bumping the prompt version invalidates every cached run, by design.
