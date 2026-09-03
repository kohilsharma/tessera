# 32. Rights policy relaxed: `licensed` by default, and the Terms Class governs serving only

Date: 2026-09-03
Status: Accepted
Supersedes: the *policy* in ADR-0018's "Licensing" constraint — "per-source `terms_class` gates
storage", and the reading of "never redistribute full bodies" that refused `api_content` whatever a
publisher's class said. ADR-0024's ladder is untouched; only its `metadata_only` redistributability
note is restated here, and it is restated unchanged.
Depends on: ADR-0001 (course-first scope), the Phase 3.6 spec §9, spec §8 (rights model)

## Context

Tessera's whole subject is provenance. Every claim it displays carries a citation, and a citation is
an invitation: *says who?* Measured at the commit before this one, that invitation opened onto
nothing for almost every publisher in the corpus.

Two rules did it, and they compounded.

**1. `api_content` was refused unconditionally.** `mayServeText` returned false for that rung under
every Terms Class, on the reasoning that a body Tessera extracted from a publisher's own page is
text no publisher handed us, so no publisher's terms can grant it. Defensible, and it applied to
exactly the text the extraction connector (#47, #70) exists to fetch — text Tessera then stored,
embedded, selected as evidence and reasoned over. The one thing it could not do with that text was
show the reader the sentence a claim came from.

**2. Auto-created publishers defaulted to `internal_only`.** The gate failed closed, which is the
right instinct for a rights gate and the wrong outcome here: every publisher a connector discovers
gets the default, and that is every publisher outside the eight fixture ones the seed classifies by
hand. Those eight are already `licensed`; the whole live corpus was not. So `routes/articles.ts`
stripped `analysisText` and `runGeneration` nulled each citation's excerpt for the whole live corpus.

The storage half had a third failure, worse than either, because it lost data. `mayStoreText` refused
text for `open_metadata`, and `runConnector` implemented the refusal by discarding the entire
sighting as `rejectedByPolicy` — the open metadata went into the bin with the body it happened to
arrive attached to. A publisher that had cleared its metadata and nothing else contributed *nothing*:
no Article, no entities, no graph edges, no timeline point. A rights rule that throws away what it
was explicitly cleared to keep is a bug wearing caution's clothes.

Underneath all three is one premise: that Tessera has commercial exposure to manage. ADR-0001
already recorded that it does not. This is a course capstone that runs on one demo machine, with
three seeded users and no public deployment, and its licence policy is free-tier and
non-commercial throughout. Optimising the reader's experience away for a commercial risk the project
does not carry is a cost paid in the demo for a benefit that does not exist.

## Decision

**The policy changes; the architecture does not.** `terms_class`, `mayServeText` and `mayStoreText`
stay exactly as modelled — they are spec §8, and a rights model is worth more to this project than
any particular setting of it.

1. **The Terms Class governs serving, and only serving.** One axis, one expression, one file
   (`backend/src/entities/Publisher.ts`): `licensed` clears every rung of the ladder including
   `api_content`; `syndicated_excerpt` clears `feed_excerpt` and nothing above it; `internal_only`
   and `open_metadata` clear no text at all. The two classes that served nothing before still serve
   nothing, so the vocabulary keeps its full range and a re-tightening is a reclassification.
2. **`licensed` is the default.** Column default plus a migration
   (`1755767000000-RelaxPublisherTermsPolicy`) that moves existing `internal_only` rows up. What a
   connector discovers is now readable by the reader who asks.
3. **Storing a body for internal analysis is cleared globally**, not per class — enrichment,
   embeddings and evidence selection all read stored text, and none of them is a publication.
   `mayStoreText` is the one place that is stated and the one line that changes it back.
4. **`rejectedByPolicy` stays.** The `ItemOutcome` member, its `Counters` key, its `IngestionRun`
   column and the Admin console's "Rejected" row are all retained and now read 0 on every run. It is
   dormant, not deleted: the ledger line a re-tightening repopulates.

## What re-tightening would take

Recorded because a relaxation that cannot be reversed cheaply is not a policy, it is a rewrite.

- **One publisher, serving:** `UPDATE publishers SET "termsClass" = 'internal_only' WHERE "domain" =
  …`. No code, no deploy, effective on the next request — both `routes/articles.ts` and
  `runGeneration`'s citation view call `mayServeText` per row at read time and cache no decision.
- **Globally, serving:** flip the column default and run the backfill inverted. Still no code.
- **`api_content` specifically** — ADR-0018's original reasoning: one clause in `mayServeText`.
- **Storage:** one line, `mayStoreText`'s body. Restoring ingestion's *refusal* is more than that, and
  deliberately so — the ledger above exists, so the change is a guard returning to a shape the
  counter is already wired for, not a new outcome threaded through the module.
- **What no re-tightening does** is purge text already stored, or unpick an embedding computed over
  it. That was true before this ADR too; reclassifying has always governed what is served and what
  arrives next, never what is held.

## Consequences

- **Article detail shows the article text, and citations carry real excerpts.** `runGeneration` needed
  no change to get there — it already asked `mayServeText`, so the answer changing was the whole fix.
- **The backfill is blunt and says so.** The column carries no provenance, so a hand-assigned
  `internal_only` is indistinguishable from a defaulted one. Nothing hand-assigned existed to lose —
  the seed's eight publishers are hand-set to `licensed` and every `internal_only` row in the
  database got there from the old default — but the `down` migration restores the default only, not
  the rows, because it cannot tell which were which.
- **Extraction's candidate rule had to be re-derived, and this is the trap in the change.** It
  selected publishers by `mayStoreText && !mayServeText(feed_excerpt)` — "we may hold the body, and
  the excerpt is not already servable". With `licensed` as the default that predicate matches nobody,
  and the extraction pass silently becomes a no-op that still reports success. It now asks whether the
  class clears the rung extraction *produces*:
  `mayStoreText && (!mayServeText(feed_excerpt) || mayServeText(api_content))`.
- **ADR-0023's embedding exception stops being an exception.** It was argued against "bodies are
  internal only, never redistributed" and accepted knowingly; serving that same text to a reader is
  now the ordinary case, so sending it to an embedding provider needs no special pleading. The
  synthesis-provider exception is a different matter and is settled in ADR-0033, not here.
- **`open_metadata` publishers now contribute their reporting** instead of vanishing: an Article, its
  entities, its edges and its timeline point, with the body held for analysis and served to nobody.
  That is what the class always meant and never did.
- **The risk accepted:** if this ever became a product the default is the wrong way round, and
  inverting it would be the first task. It is named here so that it is read rather than discovered.

