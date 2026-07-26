# 21. Role-distinct features on the generation pipeline: flashcards, admin tuning, investor consensus

Date: 2026-07-26
Status: Accepted
Depends on: ADR-0004 (distinct roles), ADR-0010 (generation contract), ADR-0009 (Admin review)

## Context

ADR-0004 requires Student, Investor, and Admin to be *genuinely* distinct roles, not one lens
flag. The user requested three concrete features — a Student flashcard generator, an Admin
control to tune model responses for everyone, and a stronger Investor differentiator. All
three are variants on the **existing evidence-frozen generation pipeline (ADR-0010)**, not new
subsystems — which is why they slot inside the flagship rather than expanding it. Each carries
one non-negotiable guardrail.

## Decision

### Student — flashcard generator
- Generates Q/A flashcards from a Story/Brief the student is studying (driven by their search +
  any detail they supply). New `Flashcard` + spaced-repetition tables; SM-2 scheduling.
- **Guardrail:** every card's answer must cite evidence from the frozen EvidenceSet — same
  invariant as all generation. No card whose answer isn't grounded is emitted.

### Admin — response tuning for everyone
- Admin owns **versioned prompt templates + generation params** (tone, verbosity, lens emphasis,
  which claim types to surface). Each `GenerationRun` records the template version it used
  (extends ADR-0010's GenerationRun).
- **Guardrail (hard):** Admin tunes the *prompt*, never the **citation-validation layer**. The
  invariant ("no displayed claim without valid evidence") lives in backend code *below* the
  prompt and is not tunable. "Tune responses" must never become "disable the check that makes
  cheap models safe."

### Investor — cross-source consensus / contradiction (the differentiator)
- The chosen "only our site does this" hook (user decision, 2026-07-26): for a company/sector,
  surface where sources **agree** vs where a source **contradicts** the consensus — each claim
  cited to frozen evidence. This is native output of the ADR-0010 pipeline (it already produces
  `consensus`, `source_specific`, `contradiction` claim types); the investor view foregrounds
  the contradiction axis with an evidence trail.
- The other two investor ideas (entity-graph watchlist via ADR-0019; auditable implication
  briefs) are built later, lower priority.

## Consequences

- Three roles gain distinct, defensible surfaces that all reuse one pipeline — high value, low
  new infrastructure (tables + views, no new services). Keeps the "fast" constraint intact.
- Flashcards and the investor view ride **inside the flagship phase**; Admin tuning lands with
  the generation surface it configures (ADR-0022).
- The citation invariant is reaffirmed as the floor under every generation feature.
