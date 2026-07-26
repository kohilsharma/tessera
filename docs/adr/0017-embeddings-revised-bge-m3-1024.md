# 17. Embeddings revised: bge-m3 @ vector(1024) (supersedes ADR-0008)

Date: 2026-07-26
Status: Accepted
Supersedes: ADR-0008 (local bge-small @ 384-dim)
Refines: ADR-0003 (provider interfaces), ADR-0014 (hybrid search)

## Context

ADR-0008 picked `bge-small` at `vector(384)` out of caution about a 4GB-VRAM GPU. Dedicated
research (2026-07-26, primary sources: HF model cards, MTEB, pgvector docs) shows that
caution was mis-calibrated on two counts:

1. **4GB VRAM is not the binding constraint.** Every strong open encoder — including bge-m3,
   gte-large, multilingual-e5-large, and Qwen3-Embedding-0.6B (~560–600M params) — fits in
   4GB at fp16 (~1–3GB weights). Quality/throughput, not memory, is the real limit.
2. **`vector(384)` foreclosed all upgrades.** pgvector's HNSW index caps at 2000 dims; more
   importantly, **1024 is the universal Matryoshka meeting point** — every competitive model
   is either natively 1024 or truncates cleanly to it. A `vector(384)` column permanently
   locks the project into the small-model tier and forces a re-embed to ever move up.

The user's constraint is explicit: "don't compromise quality much; cheap or free API is fine
if needed." bge-small (MTEB retrieval ~51) was the bottom of the quality range.

## Decision

- **Default embedding model: `bge-m3`** (BAAI, MIT license), served locally via HuggingFace
  **Text Embeddings Inference (TEI)** in a Docker container, called over HTTP from the Node
  worker. Chosen over Qwen3-Embedding-0.6B (higher raw MTEB-R, 61.82) because bge-m3's
  **native dense + sparse output pairs directly with the Postgres FTS + RRF hybrid-search
  plan (ADR-0014)**, it is a lighter pure-encoder (fast CPU fallback), MIT-licensed, 1024-dim,
  8192-token, and multilingual (100+ languages). User decision, 2026-07-26.
- **Vector column: `vector(1024)`**, HNSW cosine index. One fixed dimension, model-swappable
  within the 1024 Matryoshka family without a schema migration.
- **Cheap-API fallback (GPU busy / down / burst):** `voyage-3.5-lite` ($0.02/1M, ~200M free
  tokens on the current voyage generation) or `gemini-embedding-001` (Google AI Studio free
  tier, best multilingual quality, mind its 2048-token input cap). Both truncate to 1024.
  Exposed through the existing `EmbeddingProvider` interface (ADR-0003) — same 1024-dim space,
  so no re-index when swapping within a model family.

## Consequences

- Strict quality win at zero marginal cost: MTEB retrieval jumps from ~51 to bge-m3's
  multilingual-strong range; hybrid dense+sparse is native rather than bolted on.
- Adds one moving part: a TEI Docker container (folds into the Compose deps of ADR-0015).
- Storage rises 384→1024 dims (~4KB/vector fp32); acceptable at course scale, indexed by HNSW.
- A cross-encoder reranker (bge-reranker-base, also TEI-served) is available as a later top-k
  quality bump without changing the column.
- **Validation gate before locking:** run a 1–2k-query NDCG@10 eval on the actual news corpus
  across bge-m3 vs voyage-3.5-lite before the flagship freezes (feeds the eval harness, ADR-0011).
