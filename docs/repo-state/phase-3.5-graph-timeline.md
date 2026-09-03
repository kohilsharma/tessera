# Phase 3.5 — Knowledge graph and timeline

Entity resolution over the firehose, the bounded graph, and the timeline read views.

Phase 3.5 has started with the **entity resolution tracer bullet** (#66): `src/graph/`
(`runEntityResolution` is the one new seam, over `config.ts`'s two env-read tunables) folds every
promotable GKG Annotation to a normalized name in Postgres — case, punctuation and whitespace,
one exported SQL fragment used identically on insert and lookup, so promotion and every later
lookup search the same fold — promotes the names cited by at least `GRAPH_ENTITY_PROMOTION_FLOOR`
distinct Articles (5) to `entities`, and rebuilds the whole co-occurrence graph. Themes are never
nodes (ADR-0028); a location's identity includes GKG's FeatureID, so two Springfields stay two
Entities. Promotion is `ON CONFLICT DO UPDATE`, so an Entity that stays promoted keeps its id
across passes and the displayed name follows the commonest surface form as the window rolls; an
Entity whose annotations have aged out of the retained window is *demoted* — deleted — because the
graph is rolling. The **citation invariant** is structural, not maintained: `entity_edges` holds one
row per (pair, Article) with `ON DELETE CASCADE`, so an edge's weight is a count at read time and
deleting an Article cannot leave an uncited edge behind (asserted directly, not trusted to the
cascade). Edges are bounded at `GRAPH_EDGES_PER_ENTITY` (25) per Entity, strongest first, from
*both* ends: a pair survives if it ranks within the bound for either endpoint, so a node never
loses its own strongest neighbour for being that neighbour's 26th. The whole pass is one
transaction, so a reader sees the previous graph until it commits and a failure leaves that graph
intact — which, with stable ids, is what makes a re-run over unchanged annotations produce the same
Entities and the same edges. Operationally it is a third BullMQ queue on the same worker process,
ticking hourly at :20 (clear of the quarter-hour ingestion ticks, after clustering's :05), with an
Admin-only `POST /api/v1/graph/resolution-runs` answering `202 {status:"accepted"}` and an
`entity_resolution_runs` history table whose ledger is `promoted + belowFloor = considered`.
The graph's first reader is #68 below, and one Entity's neighbourhood (#69) is the second — as is
ADR-0028/ADR-0029's groundwork behind it, the
restored DOC connector (#60), the fixed Guardian feed (#61) and the annotated Curated Corpus
(#62) above.
**A Story's timeline** (#64) is the phase's other read view, and it costs nothing per view:
`GET /api/v1/stories/:id/timeline` assembles it from rows that already exist, so no model writes
any part of it (ADR-0020). The seam is `src/timeline/buildTimeline.ts`, and it takes a **set of
Articles**, never a query — the search timeline (#65) lays Articles drawn from many Stories on
one axis grouped into a lane per Story, and bucketing each lane against its own span would stop
parallel events reading as parallel, so `storyId` rides on every point. The axis spans the
reporting *and* the analytical events on it — an EvidenceSet freeze and a completed
GenerationRun, the two things that happen *to* a Story — and its granularity is chosen from that
span (hour, then day, then week, the finest that keeps the volume overlay under 60 bars), with
zero-count periods kept, because a lull in coverage is a fact about the Story. Only accepted
members reach it, by the same `lib/storyMembership.ts` predicate every other reader surface
tests; a failed GenerationRun is left off, having produced nothing. Tone is deliberately not an
axis: `articles.tone` is GDELT's and reaches a clustered Story only by cross-connector
enrichment, which measured zero, so the register says so in a line rather than drawing an empty
one.
**Search anything, read it as a timeline** (#65) is that seam's second consumer, and it is two
reuses rather than any new machinery: `GET /api/v1/search/timeline` and `GET /api/v1/search` share
one `matchesFor` — one accepted param vocabulary, one call into `hybridSearchArticleIds`' fused
lexical⊕semantic ranking, one load of the Articles behind the hits — so the two readings of a
query cannot disagree about *what matched or how it ranked*, and the axis is the one
`buildTimeline` already draws.
It groups the matches into **one lane per Story** via `toLanes`, which buckets each Story against
the *shared* axis' buckets, index for index (`bucketOf` is the one bucket-index definition both
use): two Stories reported in the same week land in the same column and read as parallel, which
is precisely what a per-lane `buildTimeline` call would destroy. Lanes come back in first-report
order, so the page reads down in the order the events themselves began, each naming its Story
with the same `{id, slug, title}` projection a result row carries. Accepted membership is not
re-implemented here either — search joins through it, so the firehose stays invisible for the
reason it is invisible on `/search` (ADR-0028). One deliberate ceiling, and it is the one thing
the two readings do not share: an axis is a *set* and so cannot page, so the endpoint takes the
most relevant matches up to `TIMELINE_MATCH_CAP` (200) and returns the true match count beside
them, which the page states — span included — rather than hides. A list page is smaller again
(`MAX_PAGE_SIZE`, 50), so a page of the list is a subset of the axis and never the reverse; the
test asserts that containment rather than a set equality that only holds under 50 matches. The cap
is passed to `parseListQuery` as that route's `maxPageSize` rather than written past it, so the
number the route reads with is the number it validates against. The endpoint accepts `/search`'s
whole param vocabulary — `sort`, `page` and `pageSize` included — so a reader switching readings
with their own URL never hits a 422, and ignores all three: the axis pins its ranking to relevance
itself, because the cap chooses *which* matches it carries and a route with no sort control should
not have that decided by a param the reader cannot see. No analytical events ride this axis — they
are facts about one Story's history, and a lane's heading routes into that Story to read them
(#64).
**Candidate merges, proposed rather than applied** (#67) closes the ADR-0019 guardrail the
resolution seam left open, and it is one new idea plus two thresholds. Candidates come from
Postgres' own trigram matching — `similarity(a, b) >= $n` written explicitly, never the `%`
operator, so behaviour does not depend on a `pg_trgm.similarity_threshold` GUC nobody set — over
the *same* normalized fold promotion uses, restricted to one kind and one FeatureID: the noise
worth fixing is mistyping and truncation (`Massachusets` for `Massachusetts`, `Australian
Associated` for "Australian Associated Press"), while folding `Ford` the person into `Ford` the
company is exactly the wrong merge the bar exists to prevent. Above
`GRAPH_ENTITY_MERGE_AUTO_SIMILARITY` (0.9) the pass merges the pair itself, orienting it so the
more-reported name survives; in the band down to `GRAPH_ENTITY_MERGE_REVIEW_SIMILARITY` (0.6) it
writes an `entity_merge_proposals` row and changes nothing. Both numbers are measured on real GKG
names against v3 §18.5's rule that a wrong merge is more harmful than an unresolved duplicate: the
bar sits above every wrong merge measured (`john kennedy`/`john f kennedy` 0.867, `george bush`
/`george w bush` 0.857, `united states`/`united states steel` 0.778) and the floor at the shortest
right merge still reachable (`james comey`/`james coney`, 0.600). A review floor at or above the
bar is refused at load, since an empty band would merge every candidate unseen — the one
misconfiguration of the pair that fails silently in the harmful direction.
The load-bearing idea is that **a merge is remembered by name**. `promote()` re-inserts every
folded name above the floor hourly, so a merge held only as a deleted row is undone within the
hour; `entity_aliases` is read by the fold in both `stageCandidates` and `stageMentions`, so the
next pass folds the two names before it counts them (`considered` drops by one, which the test
asserts). Every stored target is terminal — merging B into C repoints A→B at C — so the fold stays
one `LEFT JOIN` rather than a recursive walk. Refusals are keyed the same way, on the ordered
normalized pair in `entity_merge_refusals`, and therefore outlive the Entities themselves: the
regression drives both names out of the working set, watches the pass demote them, re-stages the
reporting, and asserts the rebuilt pair is proposed zero times. The memory is *read* through the
fold too, since a refused name can itself be merged away afterwards and the pair left over names
the same two things: `refusedPairSql` resolves both stored names through `entity_aliases` before it
compares, and runs twice in a pass — at candidate staging, and again after the merges, because the
merges in between write the aliases the staging could not have seen. The pass that folds
`…Commission` into `…Commision` is otherwise the pass that holds `…Commision`/`Securities and
Exchange` for an Admin to accept, an hour after a person said those two are not the same thing. `graph/merge.ts` is the one place a
merge happens, for both the automatic and the accepted path — alias write, terminal repoint, edge
carry through `LEAST`/`GREATEST` with `ON CONFLICT DO NOTHING`, then the delete whose cascade takes
the leftovers — which is what makes the Admin's accept correct with no rebuild behind it. Proposals
are re-derived from the candidate table on every pass, so one cannot outlive the working set it
described, but *upserted* on the pair rather than deleted and reinserted: the id is what a decision
names, and one regenerated hourly would 404 every decision made against a queue older than a pass —
the whole review band going quiet on a schedule. The other half of derived is a prune, so a pair the
pass no longer stages stops being a proposal, which is also how a re-oriented pair replaces its own
reversal instead of sitting beside it. A decision locks the proposal and then both Entities in id
order, and 404s three cases a reviewer reads as one: no such row, one another operator already
decided, one a pass rebuilt away. The run ledger gains `merged` and `proposed`, both outside `promoted + belowFloor =
considered` because they count *pairs* — and because both names of a merged pair were promoted by
the same pass that then folded them.
The queue is the Admin console's second review register, beside clustering's for the reason they
are the same job at two scales, with the analysis register's ruled pair reused to hold the two
sides: each labelled by its surface name and Article count, over up to three of the Articles
behind it. The sample is read from `entity_edges` rather than the annotation window — a few
thousand indexed rows against millions — and links *out* to the publisher's copy, because a
firehose-derived Article may have no accepted Story membership and so no record page to open.
Two honest ceilings, both documented in `.env.example`: `joe biden`/`joseph biden` (0.533) and
`ibm`/`i b m` (0.111) are never proposed at all, and the upgrade path for either is a
hand-written alias row rather than a lower floor that would propose noise by the hundred.
**The bounded global graph** (#68) is the graph's first reader, and the corpus statement is the
design rather than a footnote under the picture: ADR-0028's graph is firehose-derived and rolling,
so `/graph` is the one reader surface in Tessera that does *not* join through accepted Story
membership, and a reader who mistakes it for the curated corpus has misread every name on the page.
`src/graph/loadGraphView.ts` is the read seam (#69 extends it), and it carries two bounds of its own
in `graph/config.ts` — `GRAPH_VIEW_NODES` (60) and `GRAPH_VIEW_EDGES_PER_ENTITY` (6) — because the
pass's bounds keep the *stored* graph bounded and that is a larger number than one screen holds:
195 nodes at 25 neighbours each is some 2,400 pairs, a hairball to pan rather than a picture to
read. Those bounds are un-widenable structurally rather than by validation: `GET /api/v1/graph`
takes **no parameters at all**, so `?nodes=5000` is not a malformed request but a request about
nothing, and the test asserts a query string changes the payload not at all. Presence is ranked by
`COUNT(DISTINCT "articleId")` over `entity_edges` rather than over `gkg_annotations` — a few
thousand indexed rows against millions, and the same cited reporting the picture then shows — and
edges are re-bounded among the drawn nodes from *both* ends, in `rebuildEdges`' own idiom, so the
read path keeps a node's own strongest neighbour for the reason the pass keeps it. The join is
inner: an Entity nothing co-cites is not drawn, which is the honest reading of a co-occurrence
graph, and `entityCount` beside it states that the working set is wider. Two facts about time that
the page must not conflate ride separately — `retainedDays` is the rolling ingest rule, since
retention is bounded on *stored* time, while `from`/`to` are the published span of the *cited*
reporting, and the test drives a later single-name Article through the window to prove it does not
stretch `to`. `promotionFloor` rides for the empty state alone: a graph nothing has resolved into
states the rule that would fill it, which is what makes it read differently from a failed request.
Student and Investor read one graph behind `requireAuth` and no role guard — ADR-0021 gives each
role its own *features*, and a co-occurrence shown to two roles differently would be evidence about
the reader rather than about the reporting.
Review of #68 corrected three things the first pass got wrong about its own claims. The ledger
stamped `Rolling 7 days` across the span it printed beside it, and that rule is only true of the
firehose half: CONTEXT.md's **Retention Window** expires `metadata_only` GDELT rows and nothing
else, so the Curated Corpus (open to resolution, ADR-0029), anything enriched above
`metadata_only`, and any Article a Story or a Brief holds are all cited from outside the window.
The rule and the measured span are now separate ledger rows, and the backend comment that argued
"what is stored *is* the window" says what retention actually bounds. `nodes: []` also had two
causes read as one — nothing promoted, and names promoted that nothing co-cites, which the inner
join draws as nothing — so the page branches on `entityCount` and the second state names the rule
it has already cleared instead of the promotion floor; a backend test drives a name over the floor
with no pair to prove the state is reachable. And the three read statements now share one
REPEATABLE READ snapshot: the pass rebuilds the graph in one transaction, so under READ COMMITTED a
read overlapping the hourly commit could pair nodes from before it with edges from after it and
draw every name as an isolate. #68's third bound, depth, has no constant and `graph/config.ts` says
why — the global view draws edges *among* a selection rather than traversing out from a node, so
there is no hop to bound until #69's neighbourhood.
**An Entity's neighbourhood** (#69) is that hop, and it is deliberately not a second read path:
`loadEntityNeighbourhood` and `loadEdgeCitations` sit in `loadGraphView.ts` beside the global view
and share its statements, so the promotion floor, `GRAPH_VIEW_NODES` and the both-ends edge bound
are applied by one file however a reader arrived and the two pictures cannot disagree about what is
in the graph. Depth is the bound #68 had no constant for and it is `NEIGHBOURHOOD_DEPTH = 1`, not an
env knob: two hops from a well-reported name is most of the graph, since the neighbours' own
neighbourhoods overlap, so a second hop is a different picture rather than a wider one — and the
page a reader wants for it is the one every drawn neighbour already links to. One clause is the
neighbourhood's own, and it is an *exemption* rather than a bound: `boundedEdgesSql(' OR "self" =
$4')` keeps every tie to the focus past `GRAPH_VIEW_EDGES_PER_ENTITY`, because every neighbour on
the page is drawn *because* it ties to the focus and a neighbour drawn without that tie is a dot
placed for a reason the picture no longer shows. The interlinks among the neighbours stay under the
bound; the test that holds them to it counts the focus's ties apart, which is the relation that is
actually claimed — the earlier form asserted `nodes × 6` over all edges and passed only for as long
as the tie-break happened to keep the crowd small.
A Theme is the facet here and never a node (ADR-0028), and it is applied to the **citations** —
`$1` of every statement that reads one — rather than to the finished picture, so a facet narrows
what an edge weighs, what the profile counts and what the drawer opens together. Filtering the
picture afterwards would leave a weight counting reporting the drawer then refused to open, which is
the page disagreeing with itself one click later. The facet *vocabulary* is the one statement that
does not take the Theme in force: `GRAPH_VIEW_THEME_FACETS` (12) over the focus's whole reporting, so
narrowing never dead-ends on its first click — 2,072 controlled values at ~48 per Article means a
well-reported name carries hundreds, and the head is where the subjects it is known for sit, with
each count stated beside it so a reader can see this is a head and not the whole.
Under one edge, `EDGE_CITATION_CAP` (20) Articles newest first with the edge's whole weight stated
above them from one `COUNT(*) OVER ()`, so the two numbers cannot disagree; the list is metadata
only and fail-closed by construction rather than by a check — `toPublicArticle` does not select
`analysisText` at all, so even a `licensed` Publisher whose text `mayServeText` would clear serves
none here, and the text a reader may read stays on the Article record where that gate lives. Each
citation states the Story it was accepted into through `src/lib/storyMembership.ts` or `null`, which
for a firehose-derived graph is the common case and a fact about the corpus rather than a gap. A
name the graph no longer holds — demoted, or folded away by a merge — is a 404 like an id that was
never one, since an empty neighbourhood would state that a name exists with nothing around it, and
all four statements share one REPEATABLE READ snapshot for the reason #68's three do.
Frontend: `pages/EntityNeighbourhood.tsx` at `/graph/entities/:entityId` is a **Record** page, since
this is one thing with facts about it and the picture is one of those facts rather than the page's
subject. What both graph surfaces draw moved to `components/graphRegister.tsx` — the kind marks,
`toGraphElements`, the stylesheet, `GraphPlot` and `GraphKey` — rather than being redrawn per page,
mirroring the one read seam behind them; `focusId` is optional and adds `focus: true` to the one
matched node, so #68's elements are unchanged and the flag is absent rather than false on the global
view. The masthead ledger states the two things a layout cannot show — `1 hop from this name`, and
`Drawn` as `All 2 names` or `2 of 9 names` — beside the kind, the normalized names folded in, and
the reporting with its span. **Reported alongside** is the same neighbourhood in words through the
Dashboard register: the reading a keyboard and a screen reader get, and the only place a link's
evidence can be opened, since a canvas has nowhere to put a drawer. Each row states the weight the
picture draws as line width, and one `Show reporting` button toggling an `aria-expanded` /
`aria-controls` pair to a panel with its own request and its own four states — a failed edge leaves
the neighbourhood readable. The canvas tap and the row's own link go to the same URL, so "clicking a
node opens that Entity" holds for a mouse, a keyboard and a screen reader alike; the tap handler is
read from a ref so a re-render never re-settles the force layout. The facet rides in the address bar
and travels with a reader walking name to name, so a narrowed reading stays narrowed and is a link
they can share. The two empty neighbourhoods are told apart: a facet that emptied it says so and
keeps the control on screen, because clearing it is the way back, while the ticket's own criterion —
every edge rolled out of the retained window — names the window and not the promotion floor, a rule
this name has already cleared. That is also why the floor's prose sits inside the drawn branch.
**The Extraction pass, repaired** (#70). #47's transport had never once fetched a page: 0 successes
out of every attempt ever made, measured 2026-09-01, at every publisher, with not one paywall or bot
block among the failures. Three defects stacked, and the first hid the other two. `package.json`
pins `undici@8.10.0` while this Node bundles 6.24.1 (`process.versions.undici`), so the global
`fetch` built its request handler against 6 and handed it to the npm package's `Agent`, which
refused it — every attempt died as a bare `fetch failed`, cause `UND_ERR_INVALID_ARG: invalid
onRequestStart method`, before any address rule could matter. One package supplies both halves now
(`undici`'s own `fetch`), so a Node upgrade cannot re-open it. Behind that, `publicPageTarget`
condemned a whole host over one non-public entry in its DNS answer, which on this WSL2 path is what
NAT64 synthetic AAAAs (`64:ff9b::/96`, RFC 6052) made of `www.bbc.co.uk` and `arstechnica.com`;
vetting now drops **entries, never hosts**, and hands every surviving address to the pin, so undici
runs its own family selection over a set this process vetted. And the custom `connect.lookup`
answered with a scalar where undici's `options.all` owes an array, with h2 then failing
`NGHTTP2_INTERNAL_ERROR` until `allowH2: false` — HTTP/1.1 reaches every publisher on the curated
list.
The ticket offered dropping the pinned dispatcher instead. Keeping it is the choice, because
dropping it would have to relax the address rule in the same breath: undici would then dial whatever
the resolver answers, including the private address inside a mixed answer, through a DNS-TOCTOU
window the 2-second pacer widens by design. The pin is what closes that window while the URL
hostname still carries Host and TLS SNI. It costs one thing — a pinned loopback is exactly what the
rules above refuse, so no test could reach a local server through the whole function — and that is
why `fetchVettedPage` is now a seam of its own *below* the address rules: the suite drives the real
dispatcher over a real socket at `pinned.invalid` (RFC 2606, resolves nowhere), so a page comes back
only if the pin was dialled, and the vetting and hop loop above it stay injectable. The dispatcher is
`destroy`ed rather than `close`d, since two paths deliberately leave a body unread and `close()`
waits for it: refusing a page and then politely downloading it is the waste those checks exist to
avoid. `maxResponseSize` is left off the Agent for the same kind of reason — it wins the race against
`readBoundedPage` and reports `terminated`, where the run should name the ceiling it hit.
Repairing the transport was not enough to drain what it left behind. `discoverExtraction` marks
`extractionAttemptedAt` before it fetches — so one hanging page is not where every future run starts
— and the candidate query requires that mark to be null, with nothing clearing it. The runs that
could never fetch anything had therefore excluded every Article they touched, permanently.
`1755765000000-RequeueFailedExtractionAttempts` clears the mark wherever it sits on an Article still
on the excerpt rung, which given that no attempt ever succeeded is exactly the poisoned set; it
re-queues a genuine refusal too, at one further attempt each under the 20-per-run cap, which is the
price of not hand-listing which failures were which. Its `down` is deliberately empty: re-marking
would re-create the exclusion.
Measured after: all six extraction-eligible seeded feeds fetch and read (11 of 12 pages over the
600-character floor — the twelfth a BBC page with no article body, the structural loss ADR-0018
predicts), and one live NPR run attempted 10 candidates and raised 10 to `api_content` with an empty
`errorSummary`. `EXTRACTION_LIVE_SMOKE=1` is that measurement, kept: an injected `fetchPage` passes
whether or not the real one can reach a publisher, which is how a pass that had never fetched a page
shipped green.
