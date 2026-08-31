# 25. Provider architecture: one OpenAI-compatible transport, NVIDIA-hosted defaults

Date: 2026-08-31
Status: Accepted
Depends on: ADR-0003 (env-configured providers, Mock required), ADR-0017 (vector(1024))
Supersedes: ADR-0023's **hosted-default clause only** — its RAM measurement, its
`vector(1024)` decision and its provider-interface requirement all stand.

## Context

ADR-0023 moved embedding serving to a hosted API and named Google AI Studio's
`gemini-embedding-001` as the default. Phase 3 needs a *synthesis* provider as well
(ADR-0003 specified the interface; nothing implemented it), and the two have the same
shape: an OpenAI-compatible endpoint, an API key, a rate limiter, and a retry policy.

Measured 2026-08-31 across candidate hosts:

- **Asymmetric retrieval marking is load-bearing.** The E5-family models these hosts serve
  encode a query and a document differently. Unmarked, a paraphrase scored **0.42** while
  random gibberish scored **0.60** — the ranking inverts. Marked, the same pair separates
  **0.52 to 0.10**. A provider interface with no query/document distinction silently
  produces worse-than-random retrieval on these models.
- **Rate limits are counted in requests, not tokens.** NVIDIA's free tier is ~40 requests
  per minute across the whole key. Whether a corpus can be embedded at all is decided by
  batching, not by volume of text.
- **Being listed in `/v1/models` does not mean an account can call it.** NVIDIA's larger
  models (`nemotron-3-ultra-550b`, `nemotron-3-super-120b`, `deepseek-v4-pro`, `kimi-k3`,
  `gemma-4-31b`) managed 1/3 valid responses at best on the free tier, mostly 60-second
  timeouts or `404 Not found for account`. Three small models were dependable: `openai/
  gpt-oss-20b` (3/3 valid, ~17s), `poolside/laguna-xs-2.1` (3/3, ~1.1s), `minimaxai/
  minimax-m3` (3/3, ~23s).

## Decision

- **One transport, two seams.** `lib/openaiCompatible.ts` holds the POST + retry policy
  (`Retry-After` honoured, exponential backoff with jitter) shared by
  `OpenAIEmbeddingProvider` and `OpenAICompatibleSynthesisProvider`. "openai" names the
  *protocol*, not the vendor: NVIDIA, Gemini's `/v1beta/openai/` surface, DeepSeek and any
  gateway are reachable by env alone.
- **Recommended configuration is NVIDIA-hosted**: `nvidia/nemotron-3-embed-1b` for
  embeddings, one of the three verified small models for synthesis. Gemini remains
  supported and an existing Gemini-only `.env` keeps working untouched.
- **`vector(1024)` is reached by truncation, not by request.** The served model is 2048-dim
  and may refuse a `dimensions` parameter, so the provider slices the first 1024 values and
  renormalises — what NVIDIA's model card prescribes. ADR-0017's space is unchanged.
- **`EmbeddingKind` (`query` | `passage`) is part of the interface**, with
  `EMBEDDING_INPUT_STYLE` choosing how it reaches the server: `prefix` glues
  `query: `/`passage: ` on locally, `input_type` sends a body field and lets the server
  prefix. Doing both would double it.
- **`embedBatch()` is part of the interface**, defaulting to a sequential loop for providers
  with no batch endpoint. Given the request-counted limits above, this is a correctness
  concern rather than an optimisation.
- **Mock providers on both seams**, selected when no key is present (ADR-0003).

## Consequences

- Switching embedding providers means **re-embedding the corpus from scratch**: a query is
  compared against whatever embedded the documents, and the two spaces are unrelated.
- Tests must pin every provider env key to empty, not just `GEMINI_API_KEY` — the selection
  functions read four more, and a developer's real key would otherwise put the suite on the
  network and break ADR-0003's "runs with no API key" guarantee.
- A model-escalation ladder is reachable by config (`SYNTHESIS_ESCALATION_MODEL`) but unset:
  the measurements above say the stronger rung does not exist on a free tier. See ADR-0027.
