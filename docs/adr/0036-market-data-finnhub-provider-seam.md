# 36. Market data through a provider seam: Finnhub, with a Mock beside it

Date: 2026-09-04
Status: Accepted
Depends on: ADR-0003 (provider-agnostic interfaces, env-configured providers, a Mock beside them),
ADR-0033 (a provider is chosen on access and cost), ADR-0001 (course-first scope), the Phase 3.6
spec §4
Constrains: #88 (indicators), #89 (Entity tickers and the Story market panel), #90 (the market Read),
#92 (the watchlist)

## Context

Phase 3.6 §4 adds market intelligence to the Investor role, and market data is the first outside
dependency in this project that is *priced* rather than merely rate-limited. Every vendor's free tier
draws its line somewhere, and the lines are not in the same place: real-time quotes, historical
candles, fundamentals and news are unbundled and sold separately.

Two decisions were already made and do not need remaking. ADR-0003 settled the *shape*: a narrow
interface, a real implementation selected from env, and a deterministic Mock beside it so the whole
suite and an offline demo run on the same code path with no key. ADR-0033 settled the *criterion*:
Tessera is a course project, not a business (ADR-0001), so a provider is chosen on access and cost
and no decision here optimises for commercial rights. This ADR is the third application of both, and
it exists mostly to say so out loud for a surface where the temptation to reason like a business is
strongest — a market panel looks like a product feature in a way an embedding endpoint does not.

## Decision

**Market data reaches Tessera through `createMarketProvider()`, resolving Finnhub or
`MockMarketProvider` from env. Quotes are served from Redis, and no render calls a provider.**

1. **Finnhub is the real provider**, on its free tier: real-time US quotes at 60 calls a minute from
   a signup-form key. Chosen on access and cost, per ADR-0033 — it is the cheapest endpoint that
   returns a real-time US quote without a payment method, and the free tier is non-commercial, which
   ADR-0001 makes a non-issue. `MARKET_API_KEY` and `MARKET_API_BASE` are configuration; no endpoint
   or symbol table is hardcoded, so a swap is an `.env` edit.
2. **The Mock is the default**, exactly as it is for embeddings and synthesis: with no key set,
   `createMarketProvider()` returns `MockMarketProvider` and the demo works offline on the same code
   path a key switches to Finnhub. Its prices are derived from a hash of the symbol rather than read
   from a table, because a checked-in table of prices is a claim about what real companies are worth
   and is stale within a day. Its `asOf` is fixed rather than `now()`, so two calls cannot disagree.
3. **A quote carries the name of who produced it.** `source` is `"finnhub" | "mock"` *inside* the
   `Quote`, for the reason ADR-0035 gives for a publisher's leaning: a surface cannot arrange the
   parts into a number with nobody's name on it. This matters more here than there — a Mock price is
   a plausible-looking number, which is precisely the kind that must never be displayed as though a
   market produced it.
4. **The cache is the rate control, not just a freshness bound.** `quote()` reads and writes #81's
   Redis seam at `tessera:quote:v1:<SYMBOL>` with a 60-second TTL
   (`MARKET_QUOTE_CACHE_TTL_SECONDS`). One symbol on one busy Story costs one call a minute however
   many readers open it, which is what keeps a demo inside 60/min. The seam fails open, so with
   Redis down every call reaches the provider and the feature still works — slower and closer to the
   limit, never broken.
5. **A provider is never reached from a render.** Every market surface reads `quote()`, which is
   server-side and cached; a component that fetched a vendor directly would put the key in a browser
   and the rate limit in the hands of whoever refreshes fastest. Being backend-only makes the
   browser half of that true by construction. The other half — a *route* calling
   `createMarketProvider()` and bypassing the cache — is **a convention, not a constraint**: the
   factory is exported because ADR-0003's pattern and #87 both name it, and no lint enforces which
   door a caller uses (AGENTS.md: there is no lint script). `quote()` is the only door with the rate
   limiting on it, and #89 is the first ticket that could get this wrong.
6. **An unknown symbol is an answer; an outage is not.** The provider returns `null` for a symbol
   nothing trades under and *throws* when it cannot be reached, and only the first is cached. Without
   that split, an Entity carrying a ticker that will never resolve is re-asked on every page read —
   spending the whole minute's budget on a row that is settled — while a thirty-second outage would
   otherwise be pinned on screen for the full TTL after the provider came back. Finnhub forces the
   distinction to be made in our code rather than read off a status line: it answers an unknown
   symbol with a **200 and every field zeroed**, so the zero *is* the 404 and is read as one.
7. **A Ticker is validated before it becomes a URL query or a cache key**, since it will arrive
   from an `Entity` row that an Admin edits (#89). `normalizeTicker` upper-cases and shape-checks;
   `Ticker` is CONTEXT.md's term and the one this seam uses, with `symbol` left where it belongs —
   Finnhub's name for the field on the wire.

## Consequences

- The third instance of ADR-0003's pattern, and it needed no new abstraction to be the third — which
  is the seam earning its keep for the second time, after ADR-0033's provider swap needed no code.
- The offline demo keeps working, and keeps saying so. §4's "the demo runs offline with no key; the
  same code path runs live" is satisfied by construction rather than by a fixture.
- `vitest.config.ts` pins `MARKET_*` empty alongside the embedding and synthesis keys, so no test run
  can reach a live provider from a developer's own `.env`. There is no live smoke test for market
  data; if one is added it takes an opt-in flag like `SYNTHESIS_LIVE_SMOKE`.
- **What this ADR does not settle, and #89 must:** #88's indicators are pure functions over a *price
  series*, and this seam returns a single quote. Whether that series comes from Finnhub's candle
  endpoint is **unverified** — their docs and pricing pages render client-side and could not be read
  on 2026-09-04, and historical OHLCV is the field most vendors move behind a paid plan. #89 must
  check it against a real key before designing a chart around it, and if it is premium the answer is
  another free provider behind this same interface, not a paid account. Recording the question
  unanswered is deliberate: a remembered tier is exactly the kind of claim ADR-0035 refused to make
  about a publisher.
- **A null is two things, and #89 has to decide whether that matters.** `quote()` answers `null` for
  a Ticker nothing trades under *and* for a provider that could not be reached. The seam distinguishes
  them internally — that is what decides whether the answer is cached — but does not report which to
  its caller, so a panel cannot yet say "no such ticker" differently from "prices unavailable". Adding
  a third state is a change to this interface, and worth making only once a surface renders both.
- **The risk accepted**, inherited word for word from ADR-0033: free-tier terms and limits change
  without notice, and re-checking before a demo is an operational habit rather than something an ADR
  can fix. Cost stays $0/month.
