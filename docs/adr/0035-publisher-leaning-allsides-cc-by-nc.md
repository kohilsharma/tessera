# 35. Publisher leaning is a reproduced third-party rating, licensed CC BY-NC

Date: 2026-09-04
Status: Accepted
Depends on: ADR-0031 (Bureau retired; theme by role), ADR-0001 (course-first scope), the Phase 3.6
spec §3, `CONTEXT.md` "Publisher Leaning"
Constrains: the coverage spectrum and blindspot work (#86), which counts over these ratings

## Context

`Publisher` carried one classification axis — Terms Class, which is a rights question — and nothing
about stance. A reader comparing five reports on one event could see *how many* outlets agreed and
not *which part of the spectrum* they came from, which is the more useful of the two facts and the
one a "compare the coverage" product is expected to answer.

The obvious way to add it is the wrong one. Tessera's entire premise is that no displayed factual
claim exists without a citation into frozen evidence, and `PRODUCT.md` states outright that Tessera
does not rate outlet bias. A model-inferred leaning would be an uncited verdict about a real,
named organisation — the single worst place in the product to start guessing. The retired design
system objected to the whole feature on exactly that ground, and the objection was right about
inference.

What it was not right about is *reproduction*. A rating somebody else published, shown with their
name on it, is not our claim; it is a cited claim about a publisher, which is the same shape as
every other thing Tessera displays. AllSides publishes such ratings for over 2,400 sources and
licenses them under **Creative Commons Attribution-NonCommercial 4.0**: free for research and
non-commercial use with attribution, with commercial use requiring a licence agreement. ADR-0001
fixes this as a non-commercial course build, so the licence fits the project as it actually is.

## Decision

**A leaning is reproduced, never inferred.** `Publisher` gains `leaning` — AllSides' own five-point
vocabulary, stored as they publish it — and `leaningSource`, the key of who published it. No model
writes either column. The single writer is `leaningFor(domain)` in
`backend/src/lib/publisherLeaning.ts`, over a hand-checked table read off AllSides' own per-source
pages.

**A rating and its credit are inseparable, structurally.** Two CHECK constraints: one holds
`("leaning" IS NULL) = ("leaningSource" IS NULL)`, so half a claim cannot be stored, and one limits
`leaningSource` to raters Tessera reproduces, so the pairing cannot be satisfied by citing
ourselves — an inferred verdict wearing a citation as a disguise is the failure mode a
pairing-only constraint would leave open. Above the schema, `toPublicLeaning` is the only shape a
rating leaves the API in and carries the source object *inside* the value rather than beside it, so
no read path can hand a surface a verdict with nobody's name on it.

**Unrated is a stated answer, not a gap.** AllSides rates nationally prominent outlets, so most of
what ingestion discovers is unrated and the corpus a fresh `npm run seed` builds is unrated
entirely — its publishers are invented. Both surfaces that show a leaning say so in words.

**The five ratings are stored, the three-way axis is derived.** AllSides publishes Left / Lean Left
/ Center / Lean Right / Right; `DESIGN.md` paints `--left --centre --right`. Collapsing at rest
would make Tessera print "Left" where AllSides said "Lean Left", so the collapse happens once, at
the read seam, and is served — #86's spectrum and the mark cannot disagree about which side a
rating counts on.

## Consequences

**The commercial-licence boundary is a future requirement, recorded here.** CC BY-NC 4.0 permits
this build and forbids a commercial one. If Tessera is ever operated commercially, these ratings
must be relicensed from AllSides or replaced by a commercially-licensed rater *before* that
happens. The schema is shaped for it: `leaningSource` is per row, so a swap is a second entry in
`LEANING_SOURCES`, a one-line migration widening the source constraint, and a re-seed — and both
raters can coexist in the table meanwhile. Adding a rater deliberately costs a migration, because
it is a licensing decision rather than a code tweak. This is the one requirement a future operator
cannot discover from the code alone, which is why it is written down.

**Attribution is a product surface, not a footnote.** The rater's name is *inside* the rating's
value, so it cannot be dropped without deleting the rating. The licence line is a separate component
rendered once per surface, and that half is a convention rather than a constraint: a future surface
could render the mark and forget the licence. Both existing surfaces render both and are tested for
it, but the residual is real and is named here rather than papered over — removing an attribution is
a licence breach, not a style change.

**The table is small and stays small by hand.** It holds only domains actually read off AllSides'
pages, because a rating recalled rather than read would be precisely the invented claim about a real
outlet this decision exists to prevent. Extending it means reading a page.

**AllSides revises ratings.** The table is a snapshot with a retrieval date in its attribution, and
`npm run seed` converges a running database onto it — down as well as up, so a withdrawn rating
leaves Tessera too.

## Alternatives rejected

**Infer leaning from the reporting.** Rejected on the citation invariant: an uncited verdict about a
named organisation, and the objection the retired design system raised correctly.

**Collapse to three values at rest.** Rejected as a misquote. The vocabulary is the source's.

**A global attribution constant instead of a per-row source.** Rejected because it makes the
commercial-licence swap above a schema change, and because it lets a rating exist in the database
with nothing recording where it came from.

**Another rater — Ad Fontes, Media Bias/Fact Check.** Not compared on rating quality, which this
project is not equipped to judge. AllSides was chosen because it states its reuse terms plainly and
those terms fit a non-commercial build; neither alternative's licence was established, and picking a
rater whose terms are unclear would put the product in exactly the position ADR-0033 exists to keep
it out of. Should either turn out to publish on better terms, `leaningSource` is what makes the swap
cheap.
