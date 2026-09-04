# 36. Market data through a provider seam: Tiingo, with a Mock beside it

Date: 2026-09-04
Status: Accepted
Depends on: ADR-0003 (provider-agnostic interfaces, env-configured providers, a Mock beside them),
ADR-0033 (a provider is chosen on access and cost), ADR-0001 (course-first scope), the Phase 3.6
spec §4
Constrains: #88 (indicators), #89 (Entity tickers and the Story market panel), #90 (the market Read),
#92 (the watchlist)
Note: spec §4 names **Finnhub** as the real provider. That is superseded here on evidence gathered
after the spec was written — see Context. AGENTS.md's rule applies: an ADR overrides the spec.

## Context

Phase 3.6 §4 adds market intelligence to the Investor role, and market data is the first outside
dependency in this project that is *priced* rather than merely rate-limited. Every vendor's free tier
draws its line somewhere, and the lines are not in the same place: real-time quotes, historical
candles, fundamentals and news are unbundled and sold separately.

Two decisions were already made and do not need remaking. ADR-0003 settled the *shape*: a narrow
interface, a real implementation selected from env, and a deterministic Mock beside it so the whole
suite and an offline demo run on the same code path with no key. ADR-0033 settled the *criterion*: a
provider is chosen on access and cost, because this is a course project and not a business
(ADR-0001). This ADR is the third application of both.

**The spec's choice of Finnhub was tested against a real key and does not survive it.** On
2026-09-04, on one free-tier key in one minute:

| Endpoint | Result |
|---|---|
| `GET /quote?symbol=AAPL` | `200` — `{"c":328.21,"d":3.25,"dp":1.0001,"pc":324.96,...}` |
| `GET /stock/candle?symbol=AAPL&resolution=D` | `403` — `{"error":"You don't have access to this resource."}` |

So Finnhub's free tier is real-time quotes *only*. §4 also requires indicators "computed in-house
from a price series" (#88), and there is no series here to compute over. Finnhub can do half the job.

A survey of the alternatives against three constraints — an official published free tier, coverage of
a few dozen tickers, and an email-only signup with no card — returned one clear answer and several
near misses worth recording, because the near misses are the reasoning:

| Vendor | Free limits | History | Adjusted close |
|---|---|---|---|
| **Tiingo** | 50/hr, 1000/day, 500 symbols/mo | 30+ years | **free** (`adjClose`, `splitFactor`, `divCash`) |
| Financial Modeling Prep | 250/day | unconfirmed | free |
| Twelve Data | 8/min, 800/day | full | free, but **display use is gated at $29/mo** |
| Alpha Vantage | **25/day**, 100 bars | 100 bars free | **premium only** |
| EODHD / marketstack | 20/day · 100/**month** | 1 year | free |

Two findings decided it. **Alpha Vantage's free tier is unadjusted prices only** —
`TIME_SERIES_DAILY_ADJUSTED` is premium — and an SMA-50 computed over unadjusted prices reads a stock
split as a 50% crash that never happened. That is a silent wrong answer in the exact surface #88
builds, and it disqualifies the vendor regardless of its request cap. And **Tiingo answers a
comma-separated list of tickers in one request**, so a fifty-ticker watchlist refresh is one call
against a fifty-an-hour limit rather than fifty. The tightest-looking constraint in the table is not
a constraint at all.

Tiingo also turned out to serve the *quote* as well, from `/iex/`, returning the same numbers Finnhub
did for the same ticker in the same minute — `tngoLast` 328.21 against `c` 328.21, `prevClose` 324.96
against `pc` 324.96. So the question stopped being "which vendor supplies the series Finnhub cannot"
and became "is there any reason to keep two vendors". There is not.

## Decision

**Market data reaches Tessera through `createMarketProvider()`, resolving Tiingo or
`MockMarketProvider` from env. Quotes are served from Redis, and no render calls a provider.**

1. **Tiingo is the real provider, and the only one.** It serves both jobs §4 needs — real-time quotes
   from `/iex/` and an adjusted daily series from `/tiingo/daily/<ticker>/prices` — so Finnhub is
   dropped rather than kept alongside it. One vendor, one key, one rate limit, one set of terms.
   `MARKET_API_KEY` and `MARKET_API_BASE` are configuration; nothing is hardcoded, so a swap stays an
   `.env` edit. This is ADR-0003's interface earning its keep for the third time: the provider
   changed and the seam, the cache, the value shape and every caller did not.
2. **The Mock is the default**, exactly as it is for embeddings and synthesis: with no key set,
   `createMarketProvider()` returns `MockMarketProvider` and the demo works offline on the same code
   path a key switches to live data. Its prices are derived from a hash of the Ticker rather than read
   from a table, because a checked-in table of prices is a claim about what real companies are worth
   and is stale within a day. Its `asOf` is fixed rather than `now()`, so two calls cannot disagree.
3. **A quote carries the name of who produced it.** `source` is `"tiingo" | "mock"` *inside* the
   `Quote`, for the reason ADR-0035 gives for a publisher's leaning: a surface cannot arrange the
   parts into a number with nobody's name on it. This matters more here than there — a Mock price is
   a plausible-looking number, which is precisely the kind that must never be displayed as though a
   market produced it.
4. **The cache is the rate control, not just a freshness bound.** `quote()` reads and writes #81's
   Redis seam at `tessera:quote:v1:<TICKER>` with a 60-second TTL
   (`MARKET_QUOTE_CACHE_TTL_SECONDS`). One Ticker on one busy Story costs one call a minute however
   many readers open it. The seam fails open, so with Redis down every call reaches the provider and
   the feature still works — slower and closer to the limit, never broken. "50/hour is safe" is a
   Redis-up claim.
5. **A provider is never reached from a render.** Every market surface reads `quote()`, which is
   server-side and cached. Being backend-only makes the browser half of that true by construction.
   The other half — a *route* calling `createMarketProvider()` and bypassing the cache — is **a
   convention, not a constraint**: the factory is exported because ADR-0003's pattern and #87 both
   name it, and no lint enforces which door a caller uses (AGENTS.md: there is no lint script).
   `quote()` is the only door with the rate limiting on it, and #89 is the first ticket that could
   get this wrong.
6. **An unknown Ticker is an answer; an outage is not.** The provider returns `null` for a Ticker
   nothing trades under and *throws* when it cannot be reached, and only the first is cached. Without
   that split, an Entity carrying a Ticker that will never resolve is re-asked on every page read —
   spending the hour's budget on a row that is settled — while a thirty-second outage would otherwise
   be pinned on screen for the full TTL after the provider came back. Tiingo makes the distinction
   easy to read: an unknown Ticker is an empty array, not the zeroed-but-successful row Finnhub used
   to answer with.
7. **A Ticker is validated before it becomes a URL query or a cache key**, since it will arrive from
   an `Entity` row that an Admin edits (#89). `normalizeTicker` upper-cases and shape-checks; `Ticker`
   is CONTEXT.md's term and the one this seam uses, with `symbol` left where it belongs — a vendor's
   name for the field on the wire.

## Consequences

- **The free tier is personal, non-display use, and this ADR says so rather than claiming otherwise.**
  Tiingo's terms: *"you may only use the data for your own personal use and you may not display or
  share the data with another person or organization."* No free market-data tier permits display —
  that is how market data licensing works, and Twelve Data simply puts a $29/mo price on the same
  clause. What makes it acceptable here is exactly what ADR-0033 said about free-tier LLM providers:
  public data, no user PII, one demo machine, a course project with no commercial exposure
  (ADR-0001). Not a licence. If this were ever to become a product, market data is the line item that
  has to be bought first, and that is a fact about the domain rather than a defect in the build.
- **Two ADRs now share one criterion and one honest sentence.** ADR-0033 stopped this project claiming
  a no-training contract it did not have; this one declines to claim a display licence it does not
  have. The viva answer is the same shape in both places.
- Dropping Finnhub removes a key, a vendor, a rate limit and a second failure mode, and it deleted
  code rather than adding it: the `price <= 0` guard that existed only to read Finnhub's zeroed-200 as
  the 404 it was is gone, replaced by an empty array meaning what it looks like.
- `vitest.config.ts` pins `MARKET_*` empty alongside the embedding and synthesis keys, so no test run
  can reach a live provider from a developer's own `.env`. There is no live smoke test for market
  data; if one is added it takes an opt-in flag like `SYNTHESIS_LIVE_SMOKE`.
- **What #88 and #89 inherit.** `MarketProvider` gains a `dailySeries()` method when the ticket that
  needs it lands — it is not built ahead of a caller. #88's indicators must compute over `adjClose`
  rather than `close`, or a split silently becomes a crash. #92's watchlist should use the batch form
  (`?tickers=a,b,c`) rather than a loop over `quote()`, which is the whole reason the rate limit is
  comfortable.
- **A `null` is two things, and #89 has to decide whether that matters.** `quote()` answers `null` for
  a Ticker nothing trades under *and* for a provider that could not be reached. The seam distinguishes
  them internally — that is what decides whether the answer is cached — but does not report which to
  its caller, so a panel cannot yet say "no such ticker" differently from "prices unavailable".
  Adding a third state is a change to this interface, and worth making only once a surface renders
  both.
- **The risk accepted**, inherited word for word from ADR-0033: free-tier terms and limits change
  without notice, and re-checking before a demo is an operational habit rather than something an ADR
  can fix. Cost stays $0/month.
