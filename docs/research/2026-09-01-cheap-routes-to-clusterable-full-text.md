# Cheap routes to more clusterable full text

**Ticket:** [#63](https://github.com/kohilsharma/tessera/issues/63) · parent [#59](https://github.com/kohilsharma/tessera/issues/59)
**Measured:** 2026-09-01, against live sources and this repo's own code
**Location note:** the repo had no research directory. This is the first file in `docs/research/`;
put later research files here.

Three questions, in the ticket's priority order. Every number below was measured on the date
above; every terms claim cites the page that owns it, not a summary of it.

---

## Summary

1. **Extraction's 0-of-20 is not the web refusing us. It is three defects in our own fetch
   path, and the pass has never successfully fetched a single page in this environment.**
   Bypassing them, the same publishers answered `200` to the same `TesseraBot` User-Agent and
   Readability extracted a body from **46 of 48** pages — the two misses being Al Jazeera
   *video* pages that carry no article. See [§2](#2-why-extraction-returns-nothing).
2. **The obvious free full-text API is unusable.** The Guardian Open Platform Developer key
   does serve full body text for free, and its terms forbid keeping it longer than 24 hours
   (§5) and forbid AI, text-and-data-mining, and automated collection outright (§6(g), added
   2024-01-25). Both clauses are load-bearing against Tessera's frozen EvidenceSet.
   See [§1.2](#12-the-guardian-open-platform-verified-unusable).
3. **Commercial news APIs do not sell full text cheaply.** NewsAPI.org states plainly it cannot
   provide full content on any plan; NewsData.io gates full content behind $199.99/month. The
   category answers a breadth problem Tessera does not have.
4. **Five free feeds carry the whole article in the feed under licences that name our use**, and
   three more carry it under licences nobody has read yet; measured medians run 6.4k–11.3k
   characters. The best of them, The Conversation (CC BY-ND 4.0, median 11,320 chars, 50 entries
   per pull), explicitly blesses extracts and quotes with a link back — which is exactly what an
   EvidenceSet excerpt is.
   See [§1.1](#11-free-feeds-that-carry-the-whole-article).
5. **Our RSS parser is RSS-2.0-only, and the single best source is Atom.** `parseRssFeed`
   rejects `theconversation.com/us/articles.atom` with *"Not an RSS 2.0 feed: no rss > channel
   element"*. Atom support is a smaller change than anything else in this document and unlocks
   the highest-yield source found.
6. **Two of the ten seeded feeds are misclassified, and one of them is dead weight.** WSJ is
   seeded `feedProvidesFullText: true` but its feed carries a median of **155 characters** and
   every article page answers **401**. Ars Technica is seeded the same way, carries ~1k
   characters, and every article page answers **403**. See [§1.4](#14-the-ten-seeded-feeds-re-measured).
7. **Wikidata is worth adding as a narrow type check, not as a resolution layer.** Measured
   against a live GKG window's own promoted names: an exact label/alias match catches 6 of the
   type errors the ticket names (`Los Angeles`, `El Paso`, `Las Vegas`, `Pacific Ocean` typed as
   persons) — but prefix matching, the thing that would fix `Australian Associated`, is wrong in
   10 of the 25 cases where it is the only thing that matches, and is blind to GDELT's commonest
   form of truncation.
   See [§3](#3-wikidata-as-a-resolution-layer).

---

## 1. More clusterable full text

### 1.1 Free feeds that carry the whole article

Measured by pulling each feed and taking the length of `content:encoded` / Atom `content` after
stripping markup, over the 8 most recent items. "Chars" is min/median/max of that.

| Source | Feed | Chars (min/med/max) | Cost | Terms | Terms Class |
|---|---|---|---|---|---|
| **The Conversation** | `theconversation.com/us/articles.atom` (Atom) | 6,222 / **11,320** / 23,990 over 50 entries | Free, no key | [CC BY-ND 4.0](https://theconversation.com/us/republishing-guidelines); explicitly permits *"Extracts: you can run the first few lines or paragraphs … with a link back"* and *"Quotes: you can quote articles provided you include a link back"*. Forbids editing, translation, and *"systematically republish all of our articles"* | `syndicated_excerpt` |
| **ProPublica** | `propublica.org/feeds/propublica/main` | 2,515 / **10,831** / 20,365 | Free, no key | [CC BY-NC-ND 3.0 US](https://www.propublica.org/steal-our-stories); *"You can't republish our material wholesale, or automatically"*; no edits; attribution and link required | `syndicated_excerpt` |
| **EFF Deeplinks** | `eff.org/rss/updates.xml` | 2,890 / **9,288** / 13,622 | Free, no key | [CC BY 4.0](https://www.eff.org/copyright): *"may be freely distributed at will under the Creative Commons Attribution 4.0 International License"* | `licensed` |
| **Global Voices** | `globalvoices.org/feed/` | 5,306 / **7,222** / 13,282 | Free, no key | [CC BY 3.0](https://globalvoices.org/about/global-voices-attribution-policy/): *"Adapt — remix, transform, and build upon the material for any purpose, even commercially"*. Photos may differ | `licensed` |
| **CalMatters** | `calmatters.org/feed/` | 3,269 / **6,436** / 10,719 | Free, no key | [Bespoke free-republication licence](https://calmatters.org/about/republish/): attribution at top, no edits, *"Do not sell our stories"*. California-only coverage | `syndicated_excerpt` |

**Measured full text, terms not verified — do not seed until they are.** Each carries the whole
article in its feed, and none of them published a republishing or licence page at a path this
pass could find, so no Terms Class can honestly be assigned yet: The Intercept
(`theintercept.com/feed/?rss`, 5,248 / **10,679** / 34,365), Grist (`grist.org/feed/`,
3,517 / **8,215** / 9,727) and Nieman Lab (`niemanlab.org/feed/`, 2,723 / **6,749** / 11,428).
Checking one licence page is minutes of work; seeding a publisher whose terms nobody read is the
thing #40 exists to prevent.

**Verified unusable: MIT Technology Review.** Its feed does carry full text (4,469 / **6,836** /
9,752), which is why it is worth naming rather than omitting. Its
[terms of service](https://www.technologyreview.com/terms-of-service/) — which name *"our RSS
feeds"* among the covered Services, and which were amended on 2023-09-06 specifically *"to add a
provision about artificial intelligence (AI) companies and their use of our content"* — say:

> **AI and Large Language Model Usage:** Any use of the Content to create, train, enhance, evolve,
> improve (directly or indirectly) any machine learning or artificial intelligence (AI) services
> or system, algorithms, related technology and services (including, without limitation, for
> labelling, classification, content moderation, and model training purposes) … is prohibited
> without prior written consent of MIT Technology Review.

"Labelling" and "classification" name what clustering and entity resolution do, not only model
training. Same answer as the Guardian API, reached by a different route — and a useful reminder
that a feed shipping full text is not a licence to analyse it.

Controls, for calibration: NASA (already seeded) 499 / 2,315 / 8,070 and Krebs (already seeded)
4,505 / 5,541 / 24,897 — both genuinely full text, both correctly classified today. Mongabay
(`news.mongabay.com/feed/`) measured 1,473 / 1,715 / 1,727, a suspiciously flat distribution that
is a fixed-length WordPress excerpt, not a body. Phys.org measured a 249-character median: an
excerpt.

Two mechanical notes, both of which cost real sources today:

- **Atom.** `src/ingestion/rss.ts` `parseRssFeed` requires `rss > channel` and throws
  *"Not an RSS 2.0 feed"* otherwise, and The Conversation publishes Atom only. This is the
  cheapest single change in this document and it unlocks the highest-yield source found.
- **Entity expansion, again.** The Conversation and EFF both trip fast-xml-parser's *default*
  1,000-expansion cap at 1,081 and 1,008 references — the same class of failure #61 fixed for
  the Guardian. Our configured parser already admits them; a probe written with
  `processEntities: true` does not. The fix #61 shipped is load-bearing for these candidates
  too, which is worth knowing before anyone "simplifies" it back.

### 1.2 The Guardian Open Platform (verified unusable)

This is the source everyone reaches for first, so it is worth recording precisely why it does
not work, rather than leaving it to be rediscovered.

It genuinely delivers. Measured against `content.guardianapis.com` with the public `test` key:

```
GET /search?q=climate&show-fields=body,wordcount&page-size=2&api-key=test
→ 200, total: 132243
  "The Guardian climate pledge 2026"  bodyChars=19092  wordcount=1823
  "West Point's only climate scientist fired…"  bodyChars=5960  wordcount=738
```

The [access tiers](https://open-platform.theguardian.com/access/) are, verbatim:

> **Developer** — This key is for any non-commercial usage of the content, such as student
> dissertations, hackathons, nonprofit app developers. Up to 1 call per second · Up to 500 calls
> per day · Access to article text · Access to over 1,900,000 pieces of content · Free for
> non-commercial usage

A capstone project is squarely inside "student dissertations". Two clauses of the
[Open Platform terms](https://www.theguardian.com/open-platform/terms-and-conditions) are not:

> **5. Lifecycle of OP Content** — You must either replace (by re-requesting) or delete all OP
> Content you hold (whether or not published on Your Website) at least every 24 hours. For legal
> reasons, you must not keep any OP Content for longer than 24 hours.

> **6(g)** You will not: (i) use, copy, scrape, reproduce, alter, modify, collect, mine and/or
> extract the Content API, OP Content or Guardian Digital Network: (A) for any machine learning,
> machine learning language models and/or artificial intelligence-related purposes …; (B) for any
> text and data aggregation, analysis or mining purposes (including to generate any patterns,
> trends or correlations); or (C) with any machine learning and/or artificial intelligence
> technologies to generate any data or content …

Clause 6(g) was inserted on 2024-01-25 and is listed as such in the terms' own variation log.

Tessera's flagship is a frozen EvidenceSet — a SHA-256 over an Article's full analysis text,
persisted so a saved Brief still reads identically months later. §5 makes holding that text a
breach of these terms; §6(g)(A) and (C) describe the pipeline the EvidenceSet feeds. There is no
configuration of the Developer key that makes this work. The Commercial key explicitly covers
*"training models for generative artificial intelligence services, text and data mining
solutions"*, priced on usage by arrangement with `licensing@theguardian.com` — out of scope for a
course capstone, and the right answer if this becomes a product.

**This does not affect the seeded Guardian RSS connector.** The OP Terms bind a registered API
key holder; we hold none. The connector reads the public feed and the public page, `robots.txt`
`User-agent: *` allows the article paths (§2.3), and the Publisher takes the `internal_only`
default, so no Guardian text is ever served. That is a
different legal posture from accepting the OP Terms and then breaking §5 — but it is worth
stating out loud that the Guardian has published a clear view of AI use of its journalism, and
`theguardian.com`'s own site terms should be read before anything Guardian-derived is *served*
rather than analysed.

### 1.3 Commercial news APIs — the category answer

Primary-source, not a comparison blog:

- **NewsAPI.org** — [pricing FAQ](https://newsapi.org/pricing), verbatim: *"Is the full article
  content available with any plan? No, unfortunately we cannot provide the full content with our
  search results. However, you are able to use the URL included with each result to scrape this
  yourself if required."* And: *"The Developer plan may be used for development and testing in a
  development environment only, and cannot be used in a staging or production environment
  (including internally)."* Out on both counts.
- **NewsData.io** — full article content is a paid feature; the free tier (200 credits/day)
  excludes it, and the cheapest plan carrying it is the Basic plan at **$199.99/month**
  ([pricing](https://newsdata.io/pricing), [credit consumption](https://newsdata.io/blog/newsdata-credit-consumption/)).

The pattern holds across the category: these vendors sell *discovery* — headline, URL, snippet,
metadata — which is precisely what GDELT already gives Tessera for free, and precisely the thing
the ticket says not to buy more of. Their advice for full text is to fetch the page yourself,
which is §2's problem, not a purchase.

**Common Crawl CC-NEWS** deserves a line because it is the one free source of genuine full HTML at
scale: August 2026 lists **490 WARC files**, the first weighing **1,072,744,472 bytes** — on the
order of 500 GB compressed for a month, free over HTTP from `data.commoncrawl.org`. That is a
bandwidth and batch-processing cost this project cannot carry (ADR-0023 notes the demo machine has
~3 GB free RAM), and the data lands days behind the event. Correct for an offline evaluation
corpus, wrong for a 15-minute firehose.

### 1.4 The ten seeded feeds, re-measured

Extraction outcome per feed, 8 most recent items each, using Readability and this repo's own
`MIN_EXTRACTED_TEXT_LENGTH = 600` and "must beat the excerpt" rules:

| Seeded feed | `feedProvidesFullText` | Feed chars (med) | Page fetch | Extraction |
|---|---|---|---|---|
| NPR World | `false` | 193 | 200 | **8/8** |
| BBC News World | `false` | 108 | 200 | **8/8** |
| The Guardian World | `false` | 620 | 200 | **8/8** |
| Al Jazeera | `false` | 108 | 200 | **6/8** (2 misses are `/video/newsfeed/` pages) |
| ScienceDaily | `false` | 350 | 200 | **8/8** |
| TechCrunch | `false` | 125 | 200 | **8/8** |
| WSJ World News | `true` ❌ | **155** | **401** on all 8 | 0/8 |
| Ars Technica | `true` ❌ | 1,056 | **403** on all 8 | 0/8 |
| NASA news releases | `true` ✅ | 2,315 | 200 | 1/8 — page yields *less* than the feed, which is the flag working |
| Krebs on Security | `true` ✅ | 5,541 | 200 | 0/8 — same, correctly |

Two corrections fall out:

- **WSJ is dead weight.** It contributes ~150-character `feed_excerpt` Articles that are
  clusterable in name only, its pages are hard-401, and its `feedProvidesFullText: true` flag —
  which is factually wrong — is the only thing keeping the extraction pass from wasting attempts
  discovering that. Either drop it or reclassify it and accept the failures. Dropping it is
  cheaper and loses nothing.
- **Ars Technica's flag is also wrong** (a ~1k excerpt is not a body), but here the wrong flag is
  accidentally protective: its pages 403 anyway. Reclassifying it would only spend attempts.

A `feedProvidesFullText` flag that is wrong on 2 of 10 rows — both times in the direction that
silently removes a publisher from the pass forever — suggests it should be *measured* rather than
hand-asserted: compare the feed's median item length against a threshold at seed time, or let the
extraction pass discover the truth and record it.

---

## 2. Why extraction returns nothing

**Answer: none of the candidate causes in the ticket. The pass never made a successful HTTP
request.** Not one, for any publisher, in this environment. Paywalls, consent walls and bot
blocks are not the explanation; they were never reached.

### 2.1 Three independent defects in `httpFetchPage`

Running the real `httpFetchPage` from `src/ingestion/runConnector.ts:304` against live article
URLs from all six extraction-eligible feeds produced two distinct errors and zero successes.

**Defect 1 — the pinned dispatcher cannot be used with Node's `fetch` at all.** Every host that
got past the address check failed with a bare `fetch failed`. The cause chain:

```
Error: fetch failed
  cause: InvalidArgumentError UND_ERR_INVALID_ARG  invalid onRequestStart method
```

Isolated to a reproduction with no Tessera code in it at all:

```js
const d = new Agent();                                       // from "undici" 8.10.0
await fetch("https://example.com/", { dispatcher: d });      // → UND_ERR_INVALID_ARG
await fetch("https://example.com/");                         // → 200
```

`package.json:31` pins `undici@8.10.0`; this Node reports `process.versions.undici === "6.24.1"`.
Node's global `fetch` builds a request handler against its own bundled undici 6 and hands it to
the npm package's undici 8 `Agent`, whose handler validation expects the 7/8-era
`onRequestStart` and rejects it. **Any** `Agent` from the standalone package fails here — the
custom `lookup`, the SSRF vetting and the byte ceiling never run, because the request never
starts. `pageFetchDeps.createDispatcher` (`runConnector.ts:213`) is the only construction of one
and it is on the extraction path only, which is why nothing else in ingestion notices.

**Defect 2 — the SSRF allowlist rejects legitimate hosts on this network path.** BBC and Ars
Technica failed earlier, with `… is not a public http(s) page URL`. Their DNS answers explain it:

```
www.bbc.co.uk    [{"address":"151.101.104.81","family":4},{"address":"64:ff9b::9765:6851","family":6}]
arstechnica.com  [{"address":"16.59.201.83","family":4}, …, {"address":"64:ff9b::103b:c953","family":6}]
```

`64:ff9b::/96` is the RFC 6052 well-known prefix — a synthetic AAAA minted by the DNS64/NAT64
resolver on this WSL2 network path. It is not inside `2000::/3`, so
`GLOBAL_UNICAST_IPV6.check` fails, and `publicPageTarget` (`runConnector.ts:234`) rejects the
*host* because it uses `addresses.some(...)`: **one** non-public address in the answer condemns
all of them, including the perfectly public IPv4 the code would then have pinned. Like #60's TLS
reset, this is a property of the development network path rather than of the publisher — but
unlike #60 it is also a design question, because the `some()` is stricter than the pin requires.
Once an address is pinned, vetting *the pinned address* is the guarantee that matters; vetting
every address the resolver happened to mention is a stricter rule that fails closed on a
legitimate site.

**Defect 3 — the custom `lookup` breaks undici's contract.** Bypassing defect 1 by calling
undici 8's *own* `fetch` surfaces the next one:

```
Error: fetch failed
  cause: Invalid IP address: undefined
```

undici calls the `connect.lookup` hook as `lookup(hostname, { hints: 32, all: true }, cb)` — with
`all: true`, which obliges the callback to answer with an **array**. `runConnector.ts:215` ignores
its options argument and always calls back with a scalar `(null, address, family)`, so undici
reads `undefined` as the address. Honouring `options.all` gets past it, and then HTTP/2
negotiation fails (`NGHTTP2_INTERNAL_ERROR`) until `allowH2: false` is set.

A configuration that works end to end — pinned address, byte ceiling, `TesseraBot` User-Agent —
does exist:

```
A pinned+h2off https://www.npr.org/            200 768935
B plain-fetch   https://www.npr.org/           200 768935
A pinned+h2off https://techcrunch.com/         200 447274
B plain-fetch   https://techcrunch.com/        200 447274
A pinned+h2off https://www.sciencedaily.com/   200 152637
B plain-fetch   https://www.sciencedaily.com/  200 152637
```

Row B is Node's own `fetch` with no dispatcher at all. It is byte-identical to row A. Given that
`httpFetchPage` already uses `redirect: "manual"` and re-vets every hop, dropping the pinned
dispatcher and vetting each resolved target before the request is a materially smaller surface
than three interlocking undici behaviours, and closes the same rebinding window at every hop.

**Why this shipped.** `tests/ingestion.test.ts:1776-1801` exercises `httpFetchPage` with an
injected `createDispatcher`, so the real one — the undici 8 `Agent`, the only defective part — is
never constructed under test. The SSRF rules are tested thoroughly; the transport underneath them
is not tested at all. Any repair should drive the real fetcher against a local HTTP server once,
so "can this function fetch a page" is a fact the suite knows.

### 2.2 What the success rate actually looks like

With the fetch defects bypassed and everything else unchanged — same `TesseraBot/0.1`
User-Agent, same `Accept`, same Readability call, same 600-character floor, same
"must beat the excerpt" rule — over the six extraction-eligible feeds, 8 pages each:

| | |
|---|---|
| Pages attempted | 48 |
| Extracted and kept | **46 (95.8%)** |
| Refused: below 600 chars | 2 — both Al Jazeera `/video/newsfeed/` pages, which carry no article |
| Refused: no longer than excerpt | 0 |
| HTTP failures | 0 |
| Paywall / consent wall / bot block | **0** |

Extracted body length across the 46: min 869, **median 3,758**, max 8,752 characters, against
excerpts of min 91, median 162, max 860. So the pass, working, converts a headline-plus-a-sentence
into roughly **23× more text**, on essentially every candidate it is allowed to try.

Discount that 95.8% before planning against it. The eligible pool is six hand-curated
international outlets that publish clean article pages; it is not the open web. But the honest
range for *this pool* is high, and it is the pool the pass is restricted to by design
(CONTEXT.md, "Extraction"). A realistic planning figure is **80–95% on the curated feeds**, with
video and liveblog items the main structural loss, and it collapses the moment the candidate rule
is widened past curated RSS — which is exactly why ADR-0018 and #47 restrict it.

### 2.3 What the publishers actually permit

Checked because §2.2 shows we will now be fetching these pages for real. Every one of the six
allows the article paths under `User-agent: *`:

| Domain | `User-agent: *` on article paths | Named AI-crawler blocks |
|---|---|---|
| `www.npr.org` | allowed | `GPTBot: Disallow: /` |
| `www.bbc.co.uk` | allowed (`Disallow: /news/0` only) | — |
| `www.theguardian.com` | allowed | — |
| `www.aljazeera.com` | allowed | `anthropic-ai`, `ClaudeBot`, `Claude-Web`, `ChatGPT-User`, `GPTBot`, `PerplexityBot`, `cohere-ai`, `Bytespider`, all `Disallow: /` |
| `www.sciencedaily.com` | allowed (`Disallow: /test/` only) | — |
| `techcrunch.com` | allowed | — |

`TesseraBot` is not among the named agents, and Tessera is not a training crawler: it reads pages
its own curated feeds pointed it at, at one request per domain per 2 seconds, 20 per run. The
extracted body lands `api_content`, which `mayServeText` refuses to serve under **every** Terms
Class (#40, ADR-0018) — it is analysis input that never leaves the system as text. That is a
defensible posture, and it is worth recording that it was checked rather than assumed. Al
Jazeera's list is the one to watch: it shows an outlet that has thought about automated readers
and drawn a line, and if Tessera ever serves Al Jazeera text or presents itself as an AI agent,
that line moves.

---

## 3. Wikidata as a resolution layer

### 3.1 The measurement

The local database predates #43, so its `gkg_annotations` table is empty. Instead, a live GKG
window was pulled through this repo's own parser — window `20260901134500`, **1,690 documents** —
and every surface name appearing in ≥5 distinct Articles was taken, which is exactly the
`GRAPH_ENTITY_PROMOTION_FLOOR` of 5 that #66 promotes on:

```
person        3,346 distinct →  153 at floor 5
organization  2,033 distinct →  103 at floor 5
location      1,445 distinct →  238 at floor 5
theme         2,551 distinct →  999 at floor 5
```

The 153 + 103 = 256 person/organization nodes land in the same range as #59's measured
133 + 62 = 195, from a different window — so the promotion floor is behaving as #66 assumed. So
does the noise, including the ticket's own two examples:

- **Persons that are places.** `Los Angeles` (16 Articles), `El Paso` (13), `Las Vegas`,
  `Pacific Ocean`.
- **Truncated names, and the direction matters.** Most are *left*-truncated — leading words
  dropped: `Famer Ivan Rodriguez` ("Hall of Famer Ivan Rodriguez"), `Defamation League`
  ("Anti-Defamation League"), `Exchange Commission` ("Securities and Exchange Commission"),
  `Development Affairs`, `Investigation Department`. The ticket's own example,
  `Australian Associated` ("Australian Associated Press"), is the rarer *right*-truncation. §3.2
  turns on that difference.
- **Case-folding and article artefacts.** `Mcdonald`, `A Green Party` alongside `Green Party`,
  `Building Society` alongside `Nationwide Building Society`.
- **Demonyms typed as locations.** `American` (133 Articles), `British`, `Chinese`, `Iranian`,
  `Russian`, `French`, `Israeli`, `Americans`.
- **Titles glued on.** `Dame Priti Patel`.

All 256 person and organization names were then put through Wikidata's `wbsearchentities`
(prefix search over labels *and* aliases) and `wbgetentities` for `P31` (instance of), free, no
key, one request at a time, ~7 minutes wall clock:

| | Persons (153) | Organizations (103) |
|---|---|---|
| Exact label/alias match | 115 (75%) | 67 (65%) |
| Prefix/fuzzy match only | 9 (6%) | 16 (16%) |
| **No item at all** | **29 (19%)** | **20 (19%)** |

### 3.2 What that buys, and what it costs

**The type check works, and it is cheap.** Of the 115 persons that match a label or alias
exactly, 7 have a `P31` that is not human — and 6 of those are the exact defect the ticket names:

```
Los Angeles     → Q65     [Q515 city, …]
El Paso         → Q16562  [Q1093829 city of the United States, …]
Las Vegas       → Q23768  [Q1093829, …]
Pacific Ocean   → Q98     [Q9430 ocean]
Maison Margiela → Q1726925 [Q1941779 fashion house]
Christian Dior  → Q542767  [Q4830453 business]
```

The seventh is the trap: `Steve Jobs` resolves to **Q18754959, the 2015 film** (`P31: Q11424`),
because search ranked the film above the man. A rule that dropped every non-human exact match
would have deleted a real person. So the type check must *demote or flag*, never delete — which
suits #67's borderline-merge review queue exactly: a promoted person whose exact Wikidata match
is a city is a high-quality candidate for Admin review, not an automatic rejection.

**Prefix matching, the thing that would fix truncation, is the part that does not work.**
Of the 16 organization names resolved only by prefix, twelve are right and four are confidently
wrong — and the four are exactly the generic and truncated ones the check was meant to help:

```
right:  Australian Associated → Australian Associated Press
        Federal Reserve → Federal Reserve System        Chevron → Chevron Corporation
        Exxon → ExxonMobil                              Samsung → Samsung Electronics
        Visa → Visa Inc.                                Bmw → BMW Group

wrong:  Securities Exchange → Stock Exchange of Thailand
        City Council → ayuntamiento
        National League Wild Card → 2012 National League Wild Card Game
        Association Of College → Association of College and Research Libraries
```

The person side is worse, because a near-miss on a name is a different human:

```
Andrew Griffith → Andrew Griffiths      Tony Graf → Tony Grafanello
Kathryn Kirk → Kathryn Kirkwood         Stephen Lenz → Stephen Lenzini
Steigende Nachfrage → "Rising demand for immunodiagnosis" (a scientific article)
```

And there is a structural reason it cannot fix the ticket's truncation problem in general:
`wbsearchentities` matches **prefixes**, while GDELT's truncation drops **leading** words.
`Australian Associated` is a prefix of `Australian Associated Press` and resolves. `Defamation
League`, `Exchange Commission`, `Development Affairs` and `Famer Ivan Rodriguez` are not prefixes
of anything and return **no hit at all**. The one truncation the ticket names happens to be the
solvable kind; the commoner kind is invisible to this API.

**19% of promoted names have no Wikidata item, in both kinds.** For organizations that is often
useful — the misses skew to junk (`Padres Mission`, `Health News Jessica Hayek`, `Peter Health
Partners`), so silence is weak evidence of a bad name. For persons it is the opposite: the
misses are photographers, local officials, victims and minor sports figures — `Isabel Infantes`,
`Razieh Poudat`, `Lidia Zambrano-Madera`, `Bishop Edward Scharfenberger`. Those are exactly the
people local reporting is *about*. Wikidata can never be an admission gate for entities without
quietly making the graph a graph of famous people.

**Cost.** Structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing) —
*"All structured data in the main, property and lexeme namespaces is made available under the
Creative Commons CC0 License (Public domain)"*. The API is free and needs no key.
[API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) asks for *"an informative
User-Agent string with contact information"*, serial rather than parallel requests, and batching
via `|`; it states *"There is no hard speed limit on read requests"*. At Tessera's scale this is
nothing: a resolution pass promotes a couple of hundred entities, and only *newly* promoted names
need a lookup, so a pass costs tens of requests, batchable 50 ids at a time through
`wbgetentities`. The offline alternative is out of reach and worth stating so nobody prices it
later: `latest-all.json.gz` is **145 GiB** compressed and `latest-truthy.nt.gz` **66 GiB**
(measured 2026-09-01), against ADR-0023's ~3 GB-free demo machine.

### 3.3 Recommendation

**Add Wikidata as a type-and-alias annotation on promoted Entities, exact matches only, feeding
#67's review queue. Do not make it a resolver, a merge authority, or an admission gate.**

Concretely, and in the order they earn their keep:

1. **Exact-match type check (do this).** For each newly promoted person, one
   `wbsearchentities` + `wbgetentities` pair; keep the result only if the match is on a full
   label or alias. If `P31` excludes `Q5`, flag the Entity for review rather than dropping it.
   Measured yield: **6 of 153 promoted persons** — including the ticket's `Los Angeles` — caught,
   with one false positive (`Steve Jobs` the film) that review absorbs. Tens of requests per pass,
   CC0 data, no key.
2. **Store the QID where it matched exactly (do this, it is free).** It gives #67 a strong signal
   — two surface names carrying the same QID are the same Entity, with no fuzzy scoring — and it
   gives a later Entity page a canonical display name.
3. **Do not use prefix matching to repair truncation.** It fixes `Australian Associated` and
   breaks `Securities Exchange`, `City Council`, `Andrew Griffith` and `Tony Graf`, and it is
   blind to left-truncation, which is the commoner form. GDELT's truncation is better attacked
   where it is visible: a surface name that is a strict suffix of another promoted name in the
   same window (`Defamation League` ⊂ `Anti-Defamation League`, `Green Party` ⊂ `A Green Party`)
   is detectable inside Postgres, with no network call and no external authority — and it is
   precisely the shape #67's confidence-scored merge queue was designed for.
4. **Never gate promotion on a Wikidata hit.** 19% of legitimately promoted names have no item.

The honest summary: Wikidata is worth a small, well-scoped amount of work as a *checker*, and is
not the resolution layer. The measured noise is mostly GDELT's own extraction being wrong about
type and span, and that is repaired by looking at what the corpus already says — the co-occurrence
data, the suffix relations, the FeatureIDs — before it is repaired by asking a third party.

---

## 4. Findings that change this phase's plan

Ranked by how much they move the phase.

1. **Extraction should be repaired before anything in Phase 3.5 is judged on corpus quality.**
   The 968-to-210 ratio in #59 is not a statement about the web; the one pass that would fix it
   has never run. The repair is three bounded fixes in one function (§2.1) plus a test that
   drives the real fetcher. Expected effect on the local development database, which currently
   holds 157 `feed_excerpt` Articles from the six eligible feeds: those 157 rows go from a median
   of 162 characters to a median of 3,758 — clusterable, embeddable, and eligible as evidence. **There is no ticket for this.** #63 is research-only,
   and #60/#61/#62 closed the other three corpus repairs. One should be opened.
2. **Add Atom support and seed The Conversation.** One parser branch buys 50 entries per pull at
   a median of 11,320 characters, free, under a licence that names extract-and-quote as
   permitted. Nothing else in this document has that ratio of work to yield.
3. **Drop WSJ from the seed.** 20 Articles of ~150 characters that hard-401 on extraction, behind
   a `feedProvidesFullText` flag that is factually wrong. It is pure noise in the clustering
   corpus and it is the only seeded publisher that cannot be improved by any route here.
4. **The Guardian API is closed, and should be recorded as closed.** Any future "just use the
   Guardian API" instinct costs someone the same afternoon. §5's 24-hour cap is incompatible with
   frozen evidence by construction, not by degree.
5. **Terms Class needs no new values.** Every viable source maps onto the existing four:
   CC BY sources (`Global Voices`, `EFF`) are `licensed`; ND/NC sources that bless quoting
   (`The Conversation`, `ProPublica`, `CalMatters`) are `syndicated_excerpt`. The two sources that
   do not fit — the Guardian API and MIT Technology Review — do not fail on the Terms Class
   vocabulary but on a prior question the vocabulary does not ask: whether the publisher permits
   *analysis* at all, separately from serving. Both now forbid it by name. Worth noticing that
   `internal_only` reads as "we may analyse it but not serve it", and for these two that is
   exactly backwards.
6. **`feedProvidesFullText` is hand-asserted and wrong on 2 of 10 rows.** It gates the extraction
   candidate query, so a wrong `true` silently removes a publisher from the pass forever. Worth
   deriving from a measurement rather than a seed constant.
7. **Wikidata belongs in #67, not in #66.** It is a signal for the borderline-merge review queue,
   not a step in the resolution pass. Scoping it into #66 would add a network dependency to a
   transaction that is currently pure Postgres and deterministic on re-run.

---

## Reproducing

Everything above is measured, and every measurement is a small script over this repo's own
exported functions. None of them were kept — they are throwaway probes, not fixtures — but each
is a few lines:

- **Extraction defects (§2.1):** call `httpFetchPage` from `src/ingestion/runConnector.ts`
  against any live article URL and print `err.cause`. For defect 2, `dns.lookup(host, {all: true,
  verbatim: true})` on `www.bbc.co.uk`. For defect 3, pass a logging `lookup` into an undici
  `Agent` and read the options object.
- **Success rate (§2.2):** `parseRssFeed` each seeded feed, take 8 items, `fetch` each link with
  the `TesseraBot` UA, run `extractArticleText`, and classify against `MIN_EXTRACTED_TEXT_LENGTH`
  and the item's own excerpt length.
- **Feed text yields (§1.1):** `parseRssFeed` (or a raw `<entry>` split for Atom) and take
  `it.text.length` over the 8 newest items.
- **Guardian (§1.2):** `curl -D- 'https://content.guardianapis.com/search?q=climate&show-fields=body,wordcount&page-size=2&api-key=test'`.
- **GKG names (§3.1):** `resolveGkgWindowUrl` → `httpFetchBytes` → `readGkgArchive` →
  `parseGkgCsv`, then group `annotations` by `kind` and `surfaceName` counting distinct
  `documentIdentifier`.
- **Wikidata (§3.1):** `action=wbsearchentities&search=<name>&language=en&type=item` then
  `action=wbgetentities&ids=<qid>&props=claims`, with a contact-bearing User-Agent, in series.

GKG windows roll every 15 minutes and feeds move, so the exact names will differ on a re-run.
The shapes — the defect, the ~19% Wikidata miss rate, the truncation asymmetry, the yields —
should not.
