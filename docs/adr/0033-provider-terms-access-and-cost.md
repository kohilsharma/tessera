# 33. Provider selection is access and cost; no no-training contract is claimed

Date: 2026-09-03
Status: Accepted
Supersedes: the *provider terms* claimed in ADR-0018's final consequence and ADR-0023's rights
exception — "synthesis evidence text goes to the paid, contractually no-training provider
(ADR-0003)". ADR-0003's actual decisions (provider-agnostic interfaces, env-configured model IDs, our
own validate-and-repair loop, a Mock beside them) are unchanged and still hold. ADR-0023's provider
*choice* is also corrected below.
Depends on: ADR-0003, ADR-0025 (OpenAI-compatible hosts), ADR-0032

## Context

ADR-0003 never actually decided a no-training contract. It decided cheap OpenAI-compatible models
behind an interface. The no-training claim was attached to it later, by two other ADRs, as the
justification for a rights boundary: bodies may go to the embedding provider (ADR-0023's documented
exception), and full evidence text may go to synthesis *because* that provider is paid and
contractually excluded from training.

Read against the running `.env` on 2026-09-03, that sentence is wrong in both halves, and the two
providers have swapped places since it was written:

| | ADR-0023 decided | What runs |
|---|---|---|
| Embeddings | `gemini-embedding-001`, Google free tier | `nvidia/nemotron-3-embed-1b` via `integrate.api.nvidia.com` |
| Synthesis | "ADR-0003's paid provider … where no-training is contractual" | `gemini-3.5-flash-lite` via Google's OpenAI-compatible endpoint |

So the full evidence text — the strongest text Tessera holds, including extracted bodies — goes to
Google's free tier. And ADR-0023 is the ADR that established, from Google's own terms, that
**free-tier content is training-eligible**: it may be used to improve products, and human reviewers
may annotate inputs and outputs. ADR-0023 cited that fact as a reason to be careful, then named as
the safe destination the exact provider it had just described as unsafe. Nothing in the code enforced
otherwise, because nothing could: a contract is not a code path.

There is no paid provider in this project. There never was one; ADR-0003's own cost table is a survey
of cheap options, not a procurement decision. Both live providers are free tiers reached with a key
from a signup form.

## Decision

**A provider is chosen on access and cost. Tessera claims no no-training contract, and no rights
boundary rests on one.**

1. **Say what is true.** Evidence text and bodies go to free-tier hosted providers whose terms permit
   training on the content. Both are named in `.env`, not in code (ADR-0003), so both are swappable;
   what is settled here is the *justification*, which was doing work it could not do.
2. **The exception is still an exception, on a different argument.** Bodies leaving the system for
   embedding (ADR-0023) and evidence text leaving it for synthesis are both accepted, and what makes
   them acceptable is the same thing that makes ADR-0032 acceptable: public news reporting, no user
   PII, one demo machine, a course project with no commercial exposure (ADR-0001). Not a contract.
3. **ADR-0023's provider choice is corrected to what runs**: the OpenAI-compatible NVIDIA endpoint for
   embeddings, Google's OpenAI-compatible endpoint for synthesis. Both are already reachable through
   ADR-0025's transport with no new code, which is the seam earning its keep. `vector(1024)`, the HNSW
   cosine index and the `EmbeddingProvider` interface are unchanged — the swap is Matryoshka-family
   and needs no migration, though it does need a fresh volume, as `SETUP.md` says.
4. **If a no-training destination is ever wanted**, it is an `.env` change plus a paid account, and
   ADR-0003's interface is what makes that a config edit. That is the whole of the mitigation, and it
   is enough for this project.

## Consequences

- The rights story gets shorter and honest: **one** rule with teeth, per-publisher and hand-set, over
  what Tessera *serves* (ADR-0032); no claim at all about what a provider does with what it is sent.
  A viva answer of "free tier, training-eligible, and here is why that is fine for this build" is
  defensible. "Contractually no-training" was not, against this `.env`.
- Two ADRs stop contradicting the deployment. That matters more than it sounds: ADR-0023's
  training-eligibility research is good and is now attached to the provider it actually describes.
- `SYNTHESIS_LIVE_SMOKE=1` is the only test path that reaches a provider, and `vitest.config.ts` pins
  the `SYNTHESIS_*` keys empty otherwise, so the default suite still sends nothing anywhere. That
  guard predates this ADR and is unaffected by it.
- Cost stays $0/month, which was ADR-0003's actual goal.
- **The risk accepted:** free-tier terms change without notice, and rate limits are unpublished
  (ADR-0023 already flags the second). Re-checking before a demo is an operational habit, not
  something an ADR can fix.

