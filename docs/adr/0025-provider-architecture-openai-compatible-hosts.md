# 25. Provider architecture: OpenAI-compatible transport, hosted embeddings

Date: 2026-08-31
Status: Accepted
Depends on: ADR-0003 (env-configured providers, Mock required), ADR-0017 (vector(1024))
Supersedes: ADR-0023's hosted-default clause only.

## Context

Phase 3 needs hosted embeddings and, later, synthesis. Retrieval models require explicit
query/document marking, and hosted rate limits count requests, so batching is correctness
rather than a micro-optimisation. Model IDs must remain deployment configuration.

Synthesis has a stricter trust boundary than embeddings: frozen evidence text may only go to
the paid provider whose contract states it is not used for training. Protocol compatibility
alone does not authorize a destination.

## Decision

- `EmbeddingKind` (`query` | `passage`) is part of the provider interface.
- `embedBatch()` is part of the interface. Gemini uses `batchEmbedContents`; compatible
  `/embeddings` providers send multiple inputs in one request.
- Embedding model IDs come from `EMBEDDING_MODEL`; compatible endpoint URLs come from
  `EMBEDDING_API_BASE`. No provider class contains a model fallback.
- `vector(1024)` remains the storage contract. Wider compatible-provider vectors are
  truncated and renormalised; Gemini requests 1024 dimensions.
- `lib/openaiCompatible.ts` owns retry behavior shared by compatible providers.
- Synthesis model and endpoint are required configuration. `SYNTHESIS_ALLOWED_ORIGIN` must
  exactly match the HTTPS origin of `SYNTHESIS_API_BASE`, preventing accidental evidence
  disclosure to an arbitrary compatible gateway.
- Deterministic Mock providers keep tests and offline development network-free.

## Consequences

- Switching embedding providers requires re-embedding the corpus because vector spaces are
  not interchangeable.
- A Gemini deployment now sets both `GEMINI_API_KEY` and `EMBEDDING_MODEL`; this is the cost
  of keeping model IDs out of code.
- Provider names and input styles are validated rather than silently falling through.
- Contract approval remains an operator decision, but the configured origin is enforced at
  the code boundary before evidence can leave Tessera.
