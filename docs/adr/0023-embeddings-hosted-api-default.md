# 23. Embeddings: hosted API is the default; TEI is optional

Date: 2026-08-21
Status: Accepted
Partially supersedes: ADR-0017 (serving path + fallback list only — `vector(1024)`,
  the HNSW cosine index, and the `EmbeddingProvider` interface are unchanged)
Depends on: ADR-0003 (provider interfaces), ADR-0015 (local demo)

## Context

ADR-0017 chose bge-m3 served locally via a TEI Docker container, dismissing the hardware
concern on the grounds that "4GB VRAM is not the binding constraint." That analysis was
about **VRAM**. It never examined **system RAM**, which is the constraint that actually
binds.

Measured on the demo machine (2026-08-21, WSL2): **7 GB total RAM, ~3 GB available**,
GTX 1650 Ti (4 GB VRAM), 12 cores. The ADR-0015 demo stack is Compose (Postgres+pgvector,
Redis, TEI) *plus* natively Express API + BullMQ worker + Vite + a browser. TEI serving
bge-m3 wants ~2.2 GB at fp16 — which fits the 1650 Ti only if CUDA-on-WSL2 and
nvidia-container-toolkit are wired correctly, and otherwise falls back to CPU and consumes
most of the free system RAM alongside everything else.

The course mandates that all demos run on this machine. A memory-thrashing demo is a
grading risk that no embedding-quality argument offsets.

Two of ADR-0017's supporting facts were also re-verified and one is now stale:

- **`voyage-3.5-lite` no longer has free tokens.** Voyage's docs state there are no free
  tokens on voyage-3.x models. It is $0.0200/1M input (≈$0.50 for a course-scale corpus),
  requires a card, and natively supports 1024 dims.
- **Gemini free-tier content is training-eligible.** Google's terms: free-tier content may
  be used to improve products and human reviewers may annotate inputs and outputs; the paid
  tier is excluded. EEA/Switzerland/UK customers receive paid-tier terms on free services.

## Decision

- **Default `EmbeddingProvider` is a hosted API** — `gemini-embedding-001` (free tier),
  truncated to 1024 dims.
- **TEI/bge-m3 is demoted to an optional local provider**, documented but not required, and
  removed from the required Compose services. Anyone with headroom can enable it; the demo
  does not depend on it.
- **`vector(1024)` + HNSW cosine and the `EmbeddingProvider` interface are unchanged.** No
  migration, no re-index. Providers stay swappable within the 1024 Matryoshka family.
- **`voyage-3.5-lite` remains the paid fallback**, re-priced honestly: ~$0.50, card required,
  no free allotment.
- **Documented rights exception:** embeddings are computed over the best available text per
  Article, **including Readability-extracted bodies**. This is a deliberate exception to
  ADR-0018's "bodies are internal only, never redistributed," accepted knowingly because the
  cost is bounded (public news reporting, no user PII) and the alternative — embedding only
  title+lede — was judged to cost more retrieval quality than the exception costs. It is
  moot for EEA/CH/UK users. **Full evidence text for synthesis does not go here**: ADR-0003's
  paid provider handles that, where no-training is contractual.

## Consequences

- Deletes a container, a CUDA-on-WSL2 setup, a 2.2 GB model download, and a class of
  demo-day failure — for a config change, because the seam already existed.
- Embedding cost is $0 in the default path; the demo's memory budget is freed for Postgres,
  Redis, and the app.
- New failure mode: query embedding for hybrid search (ADR-0014) now requires network at
  demo time. Seeded fixtures (ADR-0007) must keep the app demonstrable if the network drops,
  and free-tier RPD is not published in Google's docs — check the live limit in AI Studio
  before relying on a number.
- ADR-0017's NDCG@10 validation gate still applies, now comparing the hosted default against
  the optional local model rather than the reverse.
- Spec §25.1's `tei` Compose service is superseded (as are its `api`/`worker`/`web` entries,
  which already contradicted ADR-0015).
