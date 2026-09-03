# Repo state — the long narrative

One entry per shipped ticket, in build order. `AGENTS.md` carries the compressed table; this is the
prose behind it, kept for the measurements and the reasoning a table cannot hold.

Split by phase so a session loads only the part it is touching — the whole narrative is ~14,000
tokens and almost none of it is relevant to any one ticket.

| Read | When | Size |
|---|---|---|
| [`repo-state/phase-1-foundation.md`](repo-state/phase-1-foundation.md) | Schema, auth, RBAC, seeded corpus, Briefs, hybrid search | ~0.1k tok |
| [`repo-state/phase-2-ingestion.md`](repo-state/phase-2-ingestion.md) | Anything behind `runConnector` — RSS, GKG, DOC, extraction | ~2.5k tok |
| [`repo-state/phase-3-flagship.md`](repo-state/phase-3-flagship.md) | Clustering, evidence freezing, generation, the role features | ~2.9k tok |
| [`repo-state/phase-3.5-graph-timeline.md`](repo-state/phase-3.5-graph-timeline.md) | Entity resolution, the graph, the timeline read views. Closed out by #72 | ~6.5k tok |
| [`repo-state/frontend.md`](repo-state/frontend.md) | The route table and the shell. Largely superseded — `DESIGN.md` is the current design authority | ~2.4k tok |
| [`repo-state/phase-3.6-product-overhaul.md`](repo-state/phase-3.6-product-overhaul.md) | The current phase (epic #71) | growing |

**Appending.** A shipped ticket writes its entry into the file for *its* phase, not this index.
This page stays a table of contents.
