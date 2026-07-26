# 3. Model providers: cheap OpenAI-compatible models + own validate-repair loop

Date: 2026-07-25
Status: Accepted

## Context

v3 §15 specified OpenAI models `gpt-5.6-luna/terra/sol`. Verified on 2026-07-25: **these
model IDs do not exist** — they are fabricated. The developer wants cheap models,
preferably Chinese providers.

Verified facts (2026-07-25, via provider docs):
- Real cheap options: DeepSeek V4 (`deepseek-v4-flash` ≈ $0.14 in / $0.28 out per 1M;
  `deepseek-v4-pro` ≈ $0.44/$0.87), Qwen3.7, GLM-5.2, Kimi-k2.7, MiniMax-M2.5.
- All expose **OpenAI-compatible AND Anthropic-compatible** endpoints.
- The `deepseek-chat`/`deepseek-reasoner` aliases deprecated 2026-07-24 → copied tutorials
  will be stale.
- Providers confirm **JSON output mode**. Strict JSON-*schema* enforcement (OpenAI-style
  guaranteed conformance) could NOT be confirmed for these providers.

## Decision

- Depend on a provider-agnostic `SynthesisProvider` / `EmbeddingProvider` interface; select
  a cheap OpenAI-compatible model via env config (no hardcoded model IDs in services).
- Do **not** assume vendor-guaranteed schema conformance. Implement our own
  **validate-and-repair loop**: request JSON, validate against our Zod/JSON schema, and on
  failure re-prompt with the validation error (bounded retries) before escalating/flagging.
- Keep a deterministic **Mock provider** so all auth/RBAC/search/UI tests run with no API key.

## Consequences

- Citation validation (ADR-0002) is enforced *by us*, in backend code, regardless of model —
  which is actually a stronger viva story than "the vendor guarantees it".
- Cost stays low; provider is swappable if one deprecates (as DeepSeek just did).
- Extra engineering: the repair loop + schema validation must be built and tested early.
