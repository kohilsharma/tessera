# 8. Embeddings: local model now (384-dim), API provider stubbed

Date: 2026-07-25
Status: **Superseded by ADR-0017** (bge-m3 @ vector(1024); 384-dim/bge-small was
mis-calibrated for the 4GB GPU). Kept for the decision trail.
Refines: ADR-0003 (provider interfaces)

## Context

Hybrid search and Story clustering both need text embeddings. Verified 2026-07-25:
- DeepSeek (our synthesis provider) has **no embeddings endpoint** — embeddings must come
  from a different source than synthesis. (Interfaces are already separate, ADR-0003.)
- Qwen `text-embedding-v4` exists, OpenAI-compatible, ~$0.07/1M tokens, 90-day free quota,
  Matryoshka dims (64–2048).
- Local models (e.g. `bge-small`, `all-MiniLM`) run free/offline in the worker.

Key constraint: **pgvector columns are fixed-dimension.** Different providers/dimensions
cannot share one `vector(N)` column or index; switching providers means re-embedding the
corpus. So "swap by env var" is not free unless dimensions are pinned equal.

## Decision

- **Working provider now: local embeddings** (`bge-small`, 384-dim) in the worker. Free,
  offline, no API key, no rate limits — pairs with the fixtures demo (ADR-0007).
- Schema uses a single `vector(384)` column + index.
- The `EmbeddingProvider` interface keeps a **documented Qwen API stub** for later. Adopting
  it is a deliberate re-embed migration (pin Qwen to 384 via Matryoshka, or rebuild the
  column), NOT a silent env flag.

## Consequences

- Cheapest, most demo-proof option; satisfies "free wherever applicable".
- No second paid vendor or network dependency in the ingestion hot path.
- One-time local model download (~tens of MB) and worker warm-up to account for.
- Embedding quality is slightly below a large API model; acceptable for clustering + hybrid
  search at course scale.
