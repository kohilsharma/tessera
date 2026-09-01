# 29. The Curated Corpus is closed to clustering but open to entity resolution

Date: 2026-09-01
Status: Accepted
Depends on: ADR-0007 (fixture corpus), ADR-0026 (Curated Corpus closed to clustering both ways),
ADR-0028 (firehose-derived rolling graph)

## Context

ADR-0026 closed the Curated Corpus to clustering in both directions: its Articles are never
clustered and its Stories never accept a live Article, so a demo Story can never turn out to be
half real and half invented.

ADR-0028 makes the graph firehose-derived and therefore rolling, which leaves the demo path
dependent on what GDELT happened to publish that morning. The insurance is hand-authored
annotations on the fixture Articles: they have no discovering connector, so retention never
touches them, and the graph they support is permanent.

That raises the question ADR-0026 appears to have already answered. If `Nvidia` is mentioned in
both a fixture Article and a firehose Article, is that one Entity or two? Reading ADR-0026's
rule across would say two — keep the invented corpus apart from the real one.

## Decision

**One Entity, with edges from both.** The Curated Corpus is closed to *clustering*, not to
*resolution*.

The two rules guard different risks, and this is why copying one across would be wrong:

- A mixed **Story** is a false claim about an event: it asserts that invented reporting and real
  reporting describe the same thing in the world. That is a factual error, and ADR-0026 exists
  to prevent it.
- A mixed **Entity** asserts only that a name was mentioned in both. Every edge still cites its
  own source Article, and fixture Publishers are plainly labelled, so a reader following any
  edge sees exactly which corpus it came from.

Two `Nvidia` rows would be the duplicate-entity failure this module exists to prevent, and a
reviewer opening one would find half the evidence missing with no way to tell why.

## Consequences

- Fixture Articles carry hand-authored annotations in the seed, shaped like GKG's, and resolve
  through the same path as everything else. They are the permanent half of a graph whose other
  half rolls over weekly.
- A future reader who knows ADR-0026 will expect the opposite rule here. That is the whole
  reason this ADR exists; the distinction is between a claim about an *event* and a mention of
  a *name*.
