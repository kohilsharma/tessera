# Phase 3 — Flagship

Clustering, frozen evidence, cited synthesis, and the three role features.

Phase 3 has started with the **clustering tracer bullet** (#49): `src/clustering/`
(`runClustering` is the one new seam, over `config.ts`'s two tunables) embeds eligible Articles
in batches, recomputes every Story's centroid from its members, assigns an Article to the
nearest live Story above the similarity threshold, and seeds a new Story from two
mutually-matching Articles from two distinct Publishers — never one, and never into or out of
the Curated Corpus, which `manual_fixture` closes in both directions. Eligibility is
`feed_excerpt` or above, so the firehose's `metadata_only` rows are never clustered and keep
aging out. A new Story is **named** by one model call over its members' headlines (#51 —
`src/clustering/naming.ts` over the shared synthesis provider; headlines only, so no body text
leaves for it), made once after the seeding transaction commits and never for a Story that
already exists. A failed call, a 15-second timeout, or a category outside the eight-value
vocabulary leaves the medoid Article's title and the `world` default in place and the run still
succeeds; with no key the Mock answers `[mock] <headline>`. Naming is clustering's one
non-deterministic step: a re-run reproduces membership, not titles.
Enrichment nulls `articles.embedding` when it writes new text, so a null
vector means one thing. Operationally it is a second BullMQ queue on the same worker process,
ticking hourly at :05, with an Admin-only `POST /api/v1/clustering/runs` that answers
`202 {status:"accepted"}` and a `clustering_runs` history table.
**Pending review** (#50) opens the band beneath the threshold: a score between the fixed
review floor (0.10 below the auto-accept threshold) and the auto-accept threshold is held as a *proposal* —
`articles.storyAssignmentStatus = 'pending_review'`, carrying the Story's id so a reviewer can
see what is proposed, but changing neither the Story's centroid nor its span. So `storyId IS NOT
NULL` no longer means membership: `lib/storyMembership.ts` holds the one predicate every reader
surface now tests (browse, Story detail, Article detail, search, Brief evidence, the Investor
rollup), a DB CHECK makes a storyId without a decision impossible, and the run ledger sums
`assigned + heldForReview + seeded + unclustered = considered`. `GET /api/v1/clustering/pending`
and `PATCH /api/v1/clustering/pending/:articleId {decision}` are the Admin-only queue and
decision; accepting makes the Article a member and recomputes the Story, rejecting returns it to
Unclustered and remembers the pairing in `rejected_story_assignments` so no later run proposes
it again. A run also voids any proposal whose vector enrichment has cleared, since a score
describing replaced text is not a judgement anyone should be shown, and rescores the Article in
the same pass.
**Story merge** (#52) is the correction the tight threshold makes necessary, and the one Admin
command here that is not an enqueue: `POST /api/v1/clustering/merges {survivorStoryId,
mergedStoryId}` (`src/clustering/merge.ts`) moves every Article to the survivor with its
decision intact — a proposal stays a proposal, for the survivor now, rescored against the
survivor's recomputed centroid (unscored where there is nothing to compare, since a run never
rescores a proposal) — recomputes the survivor's
centroid and span from the merged membership, and *deletes* the emptied row rather than
tombstoning it, guarded by a leftover check because `articles."storyId"` cascades on delete. It
refuses a self-merge, an unknown Story, and either side being in the Curated Corpus, which
ADR-0026 closes in both directions. A Brief is untouched: evidence pins Articles, not Stories.
The **generation tracer bullet** (#53) is the flagship, thinly: `POST /api/v1/stories/:id/analysis`
(`src/generation/`, `runGeneration` is the one new seam) selects evidence deterministically —
ranked by distance to the Story centroid, ≤10 Articles, ≤2 per Publisher, earliest and latest
forced in, pending assignments and text-free rows excluded — freezes it as an **EvidenceSet**
with stable `A1…` ids, ~1500-character excerpts and a SHA-256 over each Article's *full*
analysis text, then asks a cheap model for claims under the one **Lens** the caller's role
implies (an Admin names it). Validation sits below the prompt and is non-tunable: an uncited
claim, or a citation naming an id outside the frozen set, fails the run (`invalid_citations`);
unparseable or off-contract output fails it structurally; a hash that no longer matches at
persist fails it too. Every attempt persists — status, prompt version, the provider that
answered, raw answer and a `validationResult` counting what the model returned, kept and cited
that does not exist — and a repeat request for the same evidence, Lens, prompt version *and*
provider returns the existing run instead of paying twice, so a Mock-written analysis is never
served after a key is configured. It is synchronous, so a failed run is a 200 carrying
`status:"failed"` and a reader-safe `failureCode`; the provider's own message stays on the row.
**The validation contract** (#54) is what makes a cheap model publishable. A candidate too
similar to an already-selected member is skipped after ranking, so five outlets running one wire
report stop counting as five sources — the Articles stay, `distinctPublisherCount` counts
newsrooms, and a Story that is *only* wire copy collapses to one publisher and is refused
before anything is frozen (v3 §16.2's minimum of two). The EvidenceSet records its weakest
rung (`evidence_sets.dataMode`; `manual_fixture` ranks as full text, being our own complete
seed body), and below full text the prompt carries v3 §16.6's wording while validation rejects
omission phrasing outright — with investment advice and price targets rejected under *every*
Lens, and a `contradiction` rejected unless its citations resolve to two distinct Publishers.
A failing claim is now **dropped and recorded**, not fatal: the run completes if at least two
claims survive including one `consensus` *and* one claim of the run's own Lens — an Investor
analysis whose implication was dropped is a Student's analysis with an Investor's name on it
(ADR-0004) — and fails otherwise (`invalid_citations` when claims
were refused, `below_claim_floor` when the answer was merely thin). Structural failures still
fail whole. Before any failure, the answer is re-prompted twice with the specific validation
error and the rejected text (`repairAttempts` on the run, `SYNTHESIS_TIMEOUT_MS` now the budget
for *all* the calls, so a reader's wait is unchanged). Every failure mode is driven by a
transcript of the configured model's own bad answer in `tests/fixtures/synthesis/`, with one
live check behind `SYNTHESIS_LIVE_SMOKE=1`.
**Saving an analysis** (#55) closes the ownership loop, on the endpoint that already
existed: `POST /api/v1/briefs` takes an optional `generationRunId`, and with it the Brief is
pre-filled with the Story's title and category, pins the EvidenceSet's Articles (without the
accepted-membership check the manual attach applies — each one was an accepted member when its
evidence was frozen) and references that exact run through a nullable
`intelligence_briefs."generationRunId"`. Brief detail serves the frozen claims through
generation's own `loadGenerationView`, so a saved analysis reads identically to the one that was
saved and keeps reading that way after its Story is analysed again. Same endpoint means the same
rules: the Student/Investor guard refuses an Admin here as everywhere else on `/briefs`, and the
article capacity refuses a Brief smaller than the analysis cites rather than pinning part of it.
A failed run cannot be saved at all, nor can a run written under a Lens that is not the caller's
own — saving is the second door into the same claims, so it applies the rule the generation
endpoint applies at the first. A Story merge now repoints `generation_runs` and
`evidence_sets` at the survivor instead of letting `storyId`'s cascade delete a reader's saved
analysis with the emptied row.
**The Investor Lens** (#56) is a reading of that output rather than a second pipeline, so the
backend half is one query: the Investor dashboard now carries `comparableStories` — the Stories
evidence selection would accept, newest movement first, capped at 10 — under the same conditions
generation applies (accepted membership, analysis text, an embedding, ADR-0027's two distinct
Publishers after near-duplicate collapse), so a row an Investor opens is a Story an analysis can
be written about. It carries no article count, deliberately: the members eligible here are a
subset of the accepted members `/stories` counts, and one word for two numbers would be a defect.
**Admin prompt tuning** (#57) makes the prompt data: a `prompt_templates` row carries a version
label and four parameters — register, claim count, Lens emphasis, which core claim types are
asked for — and `src/generation/template.ts` is the whole surface, reading the current one and
deciding whether a proposed one may exist. Rows are immutable and never deleted, so tuning is
*creating* a version (`POST /api/v1/prompt-templates`) and activation is the only mutation
(`PATCH .../:id {isCurrent: true}`, at most one current by partial unique index) — which is what
keeps `generation_runs.promptVersion` resolving to the parameters that wrote a past run.
Invalidation is free: the version is already in the reuse key, so the version just activated has
no runs and the next request regenerates. ADR-0021's guardrail is enforced by what the boundary
refuses, not by a note — a claim count below validation's own floor, or a surfaced set without
`consensus`, is refused at the API because every run under it would fail below the prompt, and
tuned text is flattened to one bracket-free line so it cannot pose as further instructions. There
is deliberately no field for the citation check. The shipped version is inserted by the
migration, not the seed (the flagship reads it on every request), and carries exactly the prompt
this pipeline asked for before it was tunable, so applying #57 changed no output.
**Student flashcards** (#58) reuse the validated analysis rather than creating a second generation
contract: a `Flashcard` is a Student-owned question pointing at one `AnalysisClaim`, so its answer
and citations are the claim's own and still resolve through that run's frozen EvidenceSet. One
model call writes only the questions; unusable output falls back to deterministic questions over
the same cited answers. `POST /api/v1/flashcards {generationRunId}` makes or re-reads a deck from
either a Story analysis or a saved Brief analysis without resetting prior reviews, `GET
/api/v1/flashcards` serves the due session, and `POST /api/v1/flashcards/:id/reviews {grade}`
advances the card with canonical SM-2 while persisting the submitted grade and resulting schedule.
Question synthesis is shared through `flashcard_question_cache`, keyed by a SHA-256 of immutable
claim type + text, so another Student studying the same analysis does not repeat the model call.
Every route is Student-only and every query is owner-scoped.
