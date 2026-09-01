import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { Agent, type Dispatcher } from "undici";
import { IsNull, type EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article, isStrongerAnalysisTextMode } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";
import { IngestionConnector } from "../entities/IngestionConnector";
import type { ConnectorKind } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { GkgAnnotation } from "../entities/GkgAnnotation";
import { Publisher, TERMS_CLASSES, mayServeText, mayStoreText } from "../entities/Publisher";
import { PENDING_ASSIGNMENT } from "../lib/storyMembership";
import { canonicalizeUrl, normalizeTitle, publisherDomain } from "./canonicalUrl";
import { DOC_MAX_RECORDS, docRequestUrl, parseDocArtList } from "./doc";
import {
  MAX_CATCH_UP_WINDOWS,
  gkgWindowUrl,
  isGkgWindowStamp,
  parseGkgCsv,
  planGkgCatchUp,
  readGkgArchive,
  resolveGkgWindowUrl,
  type ParsedAnnotation,
} from "./gkg";
import { parseRssFeed } from "./rss";
import { extractArticleText } from "./readability";

// The one new seam in Phase 2 (#38): a plain async function taking the connector
// and its dependencies, returning the IngestionRun it persisted. Everything below
// it — fetching, parsing, URL normalization, duplicate matching, enrichment,
// counter accumulation — is internal and deliberately has no seam of its own, so
// tests survive the pipeline being reorganised.
//
// The injected fetchers are what let the whole pipeline be tested against
// committed real feeds and a real GKG window with no network access: text for
// feeds and GDELT's `lastupdate.txt`, bytes for the zipped GKG window.
export type FetchText = (url: string) => Promise<string>;
export type FetchBytes = (url: string) => Promise<Uint8Array>;

// `fetchBytes` is optional so the RSS path — which has no use for it — keeps a
// one-key deps object; the GKG path falls back to the real fetcher, and its tests
// always inject. `fetchDoc` is separate from `fetchText` rather than a flag on it
// because the DOC API demands a different caller identity and its own pacing (see
// httpFetchDocText), and `fetchPage` is separate again because a publisher's page
// is paced per domain (#47).
export type RunConnectorDeps = {
  fetchText: FetchText;
  fetchBytes?: FetchBytes;
  fetchDoc?: FetchText;
  fetchPage?: FetchText;
};

const FETCH_TIMEOUT_MS = 15_000;
// A GKG window is ~3 MB compressed, so it gets a download-shaped timeout rather
// than the feed-shaped one.
const ARCHIVE_FETCH_TIMEOUT_MS = 60_000;

// Identifies us to the publishers we are reading, with a contact path — the
// courtesy that keeps a curated feed list working. Feeds also 403 a bare default.
const USER_AGENT = "TesseraBot/0.1 (+https://github.com/kohilsharma/tessera)";

export async function httpFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

// GDELT names its window files over plain http and redirects to https, so
// redirects are followed here too.
export async function httpFetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/zip, */*" },
    signal: AbortSignal.timeout(ARCHIVE_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ADR-0018 warns that the DOC API blocks a caller that identifies itself as a bot
// or asks too often, so it gets a browser-like User-Agent and a floor on the
// interval between requests. The rate limit is real and the API states it outright:
// a rapid request is answered 200 with GDELT's own plain-text "Please limit requests
// to one every 5 seconds" notice (measured 2026-09-01).
//
// What is *not* how a block arrives: a dropped connection. This comment used to say
// consecutive requests get the TLS connection dropped instead of a status code.
// That was wrong. Measured 2026-09-01, TLS to `api.gdeltproject.org` is reset from
// the development network path whatever the pacing, while the identical plaintext
// request answers 200 — the GKG host, on a different route, is unaffected. It is a
// network-path failure, so the seeded DOC endpoint requests over plaintext (#60,
// `seedData/corpus.ts`) and this fetcher follows whatever scheme the endpoint names.
const DOC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const DOC_MIN_INTERVAL_MS = 5_000;

// ponytail: the spacing is held in a module variable, so it paces this process
// only. That holds today — the worker is a single process at concurrency 1
// (ADR-0015, #42) and nothing else fetches these — and the upgrade path if the
// worker is ever scaled out is a Redis-held timestamp, since Redis is already a
// dependency.
const readyAt = new Map<string, number>();

// One key's turn to make a request. Keyed rather than a single timestamp because
// extraction paces per publisher domain (#47) where DOC paces one endpoint — the
// same rule at two scopes.
async function pace(key: string, intervalMs: number): Promise<void> {
  const now = Date.now();
  const at = readyAt.get(key) ?? 0;
  const waitMs = Math.max(0, at - now);
  // The slot is claimed before awaiting, so two callers in the same tick queue
  // behind each other instead of both reading the same free slot.
  readyAt.set(key, Math.max(now, at) + intervalMs);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export async function spaceDocRequest(): Promise<void> {
  await pace("doc", DOC_MIN_INTERVAL_MS);
}

export async function httpFetchDocText(url: string): Promise<string> {
  await spaceDocRequest();
  const res = await fetch(url, {
    headers: { "User-Agent": DOC_USER_AGENT, Accept: "application/json, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

// #47. Readability's input: one publisher page, fetched with the courtesy
// identity the feeds already get — a page we are reading because that publisher's
// own feed pointed us at it. A domain gets one request per interval, because an
// extraction run walks a backlog and several of its candidates will share a host.
export const EXTRACTION_MIN_DOMAIN_INTERVAL_MS = 2_000;
// Pages fetched per extraction run. The tick is every 15 minutes, so this is a
// ceiling of ~1900 pages a day against a curated list of 10 feeds — comfortably
// more than they publish, while a backlog of paywalled failures can never turn
// into a burst.
export const MAX_EXTRACTION_ATTEMPTS = 20;

// A candidate's Publisher must let Tessera store the body at all, and must not
// already have cleared its excerpt for serving: no Terms Class clears text
// Tessera extracted itself (CONTEXT.md "Terms Class"), so raising such an Article
// would take out of the API exactly the text #40 put there. Derived from the two
// rights functions rather than restated, so a new class is classified once.
const EXTRACTABLE_TERMS_CLASSES = TERMS_CLASSES.filter(
  (termsClass) => mayStoreText(termsClass) && !mayServeText(termsClass, "feed_excerpt"),
);
// A body large enough to be a download rather than an article. Enforced both by
// the HTTP dispatcher and while consuming the stream, including chunked bodies.
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_REDIRECTS = 5;
const PAGE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// RSS links are untrusted input. Reject every address that is not globally
// routable before a publisher-page request can reach localhost, a private LAN or
// a cloud metadata service. Every DNS answer must be public because fetch may
// choose any of them.
const NON_PUBLIC_IPV4 = new BlockList();
const GLOBAL_UNICAST_IPV6 = new BlockList();
const NON_PUBLIC_GLOBAL_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, "ipv4");
}
// Public publisher IPv6 addresses must be global unicast. The exclusions are
// special-purpose ranges inside 2000::/3: IETF assignments/benchmarking/docs,
// deprecated 6to4, and the dedicated documentation prefix.
GLOBAL_UNICAST_IPV6.addSubnet("2000::", 3, "ipv6");
NON_PUBLIC_GLOBAL_IPV6.addSubnet("2001::", 23, "ipv6");
NON_PUBLIC_GLOBAL_IPV6.addSubnet("2002::", 16, "ipv6");
NON_PUBLIC_GLOBAL_IPV6.addSubnet("3fff::", 20, "ipv6");

type PublicPageTarget = { url: URL; address: string; family: 4 | 6 };
type PageFetchDeps = {
  resolve: typeof lookup;
  createDispatcher: (address: string, family: 4 | 6) => Dispatcher;
};

const pageFetchDeps: PageFetchDeps = {
  resolve: lookup,
  createDispatcher: (address, family) =>
    new Agent({
      connect: { lookup: (_hostname, _options, callback) => callback(null, address, family) },
      maxResponseSize: MAX_PAGE_BYTES,
    }),
};

async function lookupWithSignal(hostname: string, signal: AbortSignal, resolve: typeof lookup) {
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([resolve(hostname, { all: true, verbatim: true }), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function publicPageTarget(
  raw: string | URL,
  signal: AbortSignal,
  resolve: typeof lookup,
): Promise<PublicPageTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${raw} is not a public http(s) page URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`${url} is not a public http(s) page URL`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookupWithSignal(hostname, signal, resolve);
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) ||
        (family === 4
          ? NON_PUBLIC_IPV4.check(address, "ipv4")
          : !GLOBAL_UNICAST_IPV6.check(address, "ipv6") || NON_PUBLIC_GLOBAL_IPV6.check(address, "ipv6")),
    )
  ) {
    throw new Error(`${url} is not a public http(s) page URL`);
  }
  const selected = addresses[0] as { address: string; family: 4 | 6 };
  return { url, ...selected };
}

// Exported for the same reason spaceDocRequest is: the pacing is the requirement,
// so it is assertable without a real fetch.
export async function spaceExtractionRequest(url: string): Promise<void> {
  await pace(publisherDomain(url), EXTRACTION_MIN_DOMAIN_INTERVAL_MS);
}

type DispatcherRequestInit = RequestInit & { dispatcher: Dispatcher };

async function readBoundedPage(res: Response, url: URL): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error(`${url} exceeded ${MAX_PAGE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function httpFetchPage(rawUrl: string, deps: PageFetchDeps = pageFetchDeps): Promise<string> {
  let url = new URL(rawUrl);
  for (let redirects = 0; ; redirects += 1) {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const target = await publicPageTarget(url, signal, deps.resolve);
    url = target.url;
    await spaceExtractionRequest(url.toString());
    // A one-request Agent pins the DNS answer vetted above while preserving the
    // URL hostname for Host and TLS SNI. maxResponseSize enforces the byte ceiling
    // even when a hostile server omits Content-Length or streams chunked data.
    const dispatcher = deps.createDispatcher(target.address, target.family);
    try {
      const res = await fetch(
        url,
        {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html, application/xhtml+xml" },
          signal,
          redirect: "manual",
          dispatcher,
        } as DispatcherRequestInit,
      );

      if (PAGE_REDIRECT_STATUSES.has(res.status)) {
        if (redirects >= MAX_PAGE_REDIRECTS) throw new Error(`${rawUrl} exceeded ${MAX_PAGE_REDIRECTS} redirects`);
        const location = res.headers.get("location");
        if (!location) throw new Error(`${url} redirected without a location`);
        await res.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) throw new Error(`${url} responded ${res.status}`);
      // A PDF or a video is not something Readability can read, and reading it to
      // find that out is the waste this avoids.
      const contentType = res.headers.get("content-type") ?? "";
      if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        throw new Error(`${url} served ${contentType || "no content type"}, not HTML`);
      }
      const declaredBytes = Number(res.headers.get("content-length") ?? 0);
      if (declaredBytes > MAX_PAGE_BYTES) throw new Error(`${url} declared ${declaredBytes} bytes`);
      return await readBoundedPage(res, url);
    } finally {
      await dispatcher.close();
    }
  }
}

// The five terminal outcomes for one discovered item. Every item ends in exactly
// one, which is what makes the counters on an IngestionRun sum to `discovered`.
type ItemOutcome = "inserted" | "enriched" | "duplicate" | "rejectedByPolicy" | "failed";

type Counters = Record<ItemOutcome, number>;

// Enough reasons to diagnose a broken feed, not enough to turn errorSummary into
// a log file. Distinct, because 40 items failing for one reason is one fact.
const MAX_REPORTED_ITEM_FAILURES = 5;

class ItemFailure extends Error {}

function fail(reason: string): never {
  throw new ItemFailure(reason);
}

// Publishers are auto-created on first sighting, keyed on their already-unique
// domain. orIgnore + read-back rather than an upsert: two connectors can sight a
// new publisher at the same moment, and an upsert would overwrite the name of a
// publisher someone had already curated by hand.
// A new Publisher takes the column's `internal_only` default (#40), so its text
// is held for analysis but never served until an Admin classifies it.
async function resolvePublisher(manager: EntityManager, domain: string, name: string): Promise<Publisher> {
  const publishers = manager.getRepository(Publisher);
  await publishers.createQueryBuilder().insert().values({ domain, name }).orIgnore().execute();
  const publisher = await publishers.findOneByOrFail({ domain });
  // A name that is still just the domain is what GKG leaves behind — it reports no
  // publisher name at all — so the first source that offers a real one replaces
  // it. Conditioned on the held name, so a curated name is never overwritten.
  if (publisher.name === domain && name !== domain) {
    await publishers.update({ id: publisher.id, name: domain }, { name });
    publisher.name = name;
  }
  return publisher;
}

function utcDayBounds(at: Date): [Date, Date] {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return [start, new Date(start.getTime() + 24 * 60 * 60 * 1000)];
}

// CONTEXT.md "Duplicate": the same reporting at a *different* canonical URL,
// matched on normalized title + publisher + date.
// Half-open on the day bounds, not an inclusive BETWEEN: `timestamptz` is
// microsecond-precision, so an inclusive upper bound one millisecond short of
// midnight lets the last fraction of a day escape matching.
// ponytail: candidates are fetched by related Publisher domains and calendar day
// and compared in memory. The suffix relation lets an authoritative GKG apex
// (`indiatimes.com`) match an RSS document host beneath it. A PublisherAlias
// table is the upgrade if cross-brand subdomains make that relation too broad.
async function findDuplicateId(
  manager: EntityManager,
  domain: string,
  title: string,
  publishedAt: Date,
): Promise<string | null> {
  const [dayStart, nextDay] = utcDayBounds(publishedAt);
  const candidates = await manager
    .getRepository(Article)
    .createQueryBuilder("article")
    .innerJoin("article.publisher", "publisher")
    .select(["article.id", "article.title"])
    .where(
      `(publisher.domain = :domain OR publisher.domain LIKE :childDomain OR :domain LIKE ('%.' || publisher.domain))`,
      { domain, childDomain: `%.${domain}` },
    )
    .andWhere(`article."publishedAt" >= :dayStart`, { dayStart })
    .andWhere(`article."publishedAt" < :nextDay`, { nextDay })
    .getMany();
  const normalized = normalizeTitle(title);
  return candidates.find((candidate) => normalizeTitle(candidate.title) === normalized)?.id ?? null;
}

type HeldArticle = {
  id: string;
  publisherId: string;
  analysisTextMode: AnalysisTextMode;
  discoveredByConnectorId: string | null;
};

// A same-URL sighting enriches when it persists any new contribution: stronger
// text, GKG tone, or GKG's authoritative source Publisher. Equal or weaker
// sightings that add nothing are duplicates, regardless of which connector saw
// them (CONTEXT.md "Enrichment").
// `text` is nullable because a `metadata_only` sighting has none — and because
// that rung is the weakest, such a sighting can never clear the loop's condition,
// so the text update below only ever writes text that exists.
async function reconcileWithHeld(
  manager: EntityManager,
  held: HeldArticle,
  connectorId: string,
  text: string | null,
  mode: AnalysisTextMode,
  tone: number | null,
  sourcePublisherId: string | null,
  publisherName: string | null,
): Promise<ItemOutcome> {
  const articles = manager.getRepository(Article);
  const publishers = manager.getRepository(Publisher);
  const heldPublisher = await publishers.findOneByOrFail({ id: held.publisherId });
  const sourcePublisher =
    sourcePublisherId === null ? null : await publishers.findOneByOrFail({ id: sourcePublisherId });
  const toneUpdate =
    tone === null ? null : await articles.update({ id: held.id, tone: IsNull() }, { tone });

  let publisherUpdated = false;
  if (sourcePublisher && sourcePublisher.id !== held.publisherId) {
    const heldHasText = held.analysisTextMode !== "metadata_only";
    const raisesServingRights =
      heldHasText &&
      mayServeText(sourcePublisher.termsClass, held.analysisTextMode) &&
      !mayServeText(heldPublisher.termsClass, held.analysisTextMode);
    if ((!heldHasText || mayStoreText(sourcePublisher.termsClass)) && !raisesServingRights) {
      // Match both identity and mode so a concurrent text enrichment or Publisher
      // correction cannot invalidate the rights decision made above.
      publisherUpdated =
        (
          await articles
            .createQueryBuilder()
            .update()
            .set({ publisherId: sourcePublisher.id })
            .where(`id = :id AND "publisherId" = :publisherId AND "analysisTextMode" = :mode`, {
              id: held.id,
              publisherId: held.publisherId,
              mode: held.analysisTextMode,
            })
            .execute()
        ).affected === 1;
    }
  }

  const improvePublisherName = async (publisherId: string): Promise<boolean> => {
    if (!publisherName) return false;
    const updated = await publishers
      .createQueryBuilder()
      .update()
      .set({ name: publisherName })
      .where(`id = :publisherId AND "name" = "domain" AND "name" <> :publisherName`, {
        publisherId,
        publisherName,
      })
      .execute();
    return updated.affected === 1;
  };

  let current = publisherUpdated ? { ...held, publisherId: sourcePublisher!.id } : held;
  while (isStrongerAnalysisTextMode(mode, current.analysisTextMode)) {
    if (text !== null) {
      const currentPublisher = await publishers.findOneByOrFail({ id: current.publisherId });
      if (!mayStoreText(currentPublisher.termsClass)) return "rejectedByPolicy";
    }
    // Compare-and-set the rung and Publisher: concurrent sightings may hold
    // different dedupe locks, so only the transaction that still sees this exact
    // state may count the transition as enrichment.
    const updated = await articles
      .createQueryBuilder()
      .update()
      .set({
        analysisText: text,
        analysisTextMode: mode,
        discoveredByConnectorId: current.discoveredByConnectorId ?? connectorId,
      })
      .where(`id = :id AND "analysisTextMode" = :heldMode AND "publisherId" = :publisherId`, {
        id: current.id,
        heldMode: current.analysisTextMode,
        publisherId: current.publisherId,
      })
      .execute();
    if (updated.affected === 1) {
      // The vector and any pending proposal were both judgements about the text
      // this update replaced. Clear them together before an Admin can accept a
      // score for reporting Tessera no longer holds.
      await manager.query(
        `UPDATE "articles"
         SET "embedding" = NULL,
             "storyId" = CASE WHEN "storyAssignmentStatus" = $2 THEN NULL ELSE "storyId" END,
             "storyAssignmentStatus" = CASE WHEN "storyAssignmentStatus" = $2 THEN NULL ELSE "storyAssignmentStatus" END,
             "storyAssignmentScore" = CASE WHEN "storyAssignmentStatus" = $2 THEN NULL ELSE "storyAssignmentScore" END
         WHERE "id" = $1`,
        [current.id, PENDING_ASSIGNMENT],
      );
      await improvePublisherName(current.publisherId);
      return "enriched";
    }

    current = await articles.findOneOrFail({
      where: { id: current.id },
      select: { id: true, publisherId: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
  }
  const nameUpdated = await improvePublisherName(current.publisherId);
  return toneUpdate?.affected === 1 || publisherUpdated || nameUpdated ? "enriched" : "duplicate";
}

// CONTEXT.md "GKG Annotation": stage the occurrences GKG already extracted
// against the Article they were reported for, once it has an id. Idempotent —
// the unique occurrence index makes re-reading a window insert nothing — so this
// can run on every sighting rather than only on insert, which is what lets GKG
// contribute annotations to an Article another connector found first.
// Returns how many were new, because that is what distinguishes an Enrichment
// from a Duplicate.
// Exported for the seed (#62): the Curated Corpus's hand-authored annotations are
// staged through this, so occurrence identity — and therefore what a re-seed does
// twice, which is nothing — is the connector's own behaviour rather than a second
// implementation of it.
export async function stageAnnotations(
  manager: EntityManager,
  articleId: string,
  annotations: ParsedAnnotation[] | undefined,
): Promise<number> {
  if (!annotations || annotations.length === 0) return 0;
  const staged = await manager
    .getRepository(GkgAnnotation)
    .createQueryBuilder()
    .insert()
    .values(annotations.map((annotation) => ({ articleId, ...annotation })))
    .orIgnore()
    .returning(["id"])
    .execute();
  return staged.raw.length;
}

// Both same-URL paths — the Article we already held, and the one that won a race
// with our own insert — reconcile the sighting and then stage its annotations
// against the row that survived. One function, so the ordering of the two steps
// and reconcileWithHeld's long argument list each exist in exactly one place.
async function reconcileAndStage(
  manager: EntityManager,
  existing: HeldArticle,
  item: DiscoveredItem,
  connectorId: string,
  text: string | null,
  sourcePublisherId: string | null,
): Promise<ItemOutcome> {
  const outcome = await reconcileWithHeld(
    manager,
    existing,
    connectorId,
    text,
    item.mode,
    item.tone,
    sourcePublisherId,
    item.publisherName,
  );
  // An item declined on rights grounds must leave no derived rows behind.
  if (outcome === "rejectedByPolicy") return outcome;
  const staged = await stageAnnotations(manager, existing.id, item.annotations);
  // A sighting that staged occurrences nobody held contributed something, so it
  // is an Enrichment even with nothing else to add (CONTEXT.md "Enrichment").
  return outcome === "duplicate" && staged > 0 ? "enriched" : outcome;
}

// What every connector reduces to before anything touches the database: one
// discovered document, already carrying the rung it can honestly claim. Nullable
// where a source may simply not say — validated per item below, so a source that
// omits something fails that item rather than the run.
type DiscoveredItem = {
  title: string | null;
  // Not yet canonicalized: normalization happens in one place, on the way in.
  link: string | null;
  publishedAt: Date | null;
  text: string | null;
  mode: AnalysisTextMode;
  tone: number | null;
  // GKG names the Publisher independently of the document host. Undefined for
  // connectors such as RSS that derive it from the canonical URL; null means a
  // source that promised the field supplied no usable value.
  sourceDomain?: string | null;
  // The pre-resolution entity occurrences the source already extracted (#43).
  // Absent for every connector but GKG — nothing else reports them.
  annotations?: ParsedAnnotation[];
  // The publisher's display name where the source gives one. Null lets the domain
  // name it — GKG supplies nothing better, and a Publisher is keyed on domain
  // regardless.
  publisherName: string | null;
  // Why this item cannot be stored, decided during discovery rather than below —
  // a Readability extraction that came back empty or would not fetch (#47). Fails
  // the item with this reason, so a paywall is one counted outcome with a legible
  // cause rather than a gap in the ledger.
  failure?: string;
};

// A run's whole discovery step: the items it found, the nearest thing the source
// has to a cursor, and anything about the *discovery* an operator needs to know —
// as against the per-item failures the run loop collects below.
type Discovery = { items: DiscoveredItem[]; cursor: string | null; notes?: string[] };

async function discoverRss(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  const feed = parseRssFeed(await deps.fetchText(connector.endpoint));
  return {
    cursor: feed.lastBuildDate,
    items: feed.items.map((item) => ({
      ...item,
      mode: "feed_excerpt",
      // No connector but GKG reports tone.
      tone: null,
      publisherName: feed.channelTitle,
    })),
  };
}

// #45. CONTEXT.md "Window Cursor": the last window this connector *finished*, in
// GDELT's own 14-digit terms, read back from the runs it persisted rather than
// held anywhere else. Ordered by the cursor itself rather than by time, because
// the stamps are fixed-width — lexical order is chronological order — so the
// cursor cannot go backwards because a run completed out of order. Only succeeded
// runs count: re-reading a window is idempotent, so a failed run's window is
// simply read again.
async function lastProcessedWindow(connectorId: string): Promise<string | null> {
  const runs = AppDataSource.getRepository(IngestionRun);
  let before: string | null = null;
  while (true) {
    const query = runs
      .createQueryBuilder("run")
      .select(["run.cursor"])
      .where("run.connectorId = :connectorId", { connectorId })
      .andWhere("run.status = :status", { status: "succeeded" })
      .andWhere("run.cursor IS NOT NULL")
      .orderBy("run.cursor", "DESC")
      .limit(1);
    if (before) query.andWhere("run.cursor < :before", { before });

    const run = await query.getOne();
    if (!run?.cursor) return null;
    if (isGkgWindowStamp(run.cursor)) return run.cursor;
    before = run.cursor;
  }
}

// ADR-0018: poll `lastupdate.txt`, take the current 15-minute GKG window, and turn
// its rows into Articles. ADR-0024: GKG has no body and no snippet at all, so
// every row is the ladder's weakest rung — `metadata_only`, with genuinely null
// text rather than a title copied into the text column, which is the lie the rung
// was added to prevent.
//
// #45: `lastupdate.txt` names only the *current* window, so a worker that was off
// heals the windows between its cursor and that one before going live, bounded by
// the catch-up cap.
async function discoverGkg(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  const fetchBytes = deps.fetchBytes ?? httpFetchBytes;
  const current = resolveGkgWindowUrl(await deps.fetchText(connector.endpoint), connector.endpoint);
  const held = await lastProcessedWindow(connector.id);
  const { stamps, skippedWindows } = planGkgCatchUp(held, current.stamp);
  const notes: string[] =
    skippedWindows > 0
      ? [
          `skipped ${skippedWindows} missed window(s) before ${current.stamp}: over the ` +
            `${MAX_CATCH_UP_WINDOWS}-window catch-up cap`,
        ]
      : [];

  const items: DiscoveredItem[] = [];
  const failures: string[] = [];
  // The cursor advances only through the contiguous prefix that was read. Later
  // windows still ingest after a failure, but remain retryable with the gap on
  // the next run; re-reading them is idempotent.
  let cursor = held;
  let cursorBlocked = false;
  for (const stamp of stamps) {
    try {
      const csv = readGkgArchive(await fetchBytes(gkgWindowUrl(current, stamp)));
      items.push(
        ...parseGkgCsv(csv).map((row) => ({
          title: row.title,
          link: row.documentIdentifier,
          publishedAt: row.publishedAt,
          text: null,
          mode: "metadata_only" as const,
          tone: row.tone,
          sourceDomain: row.sourceDomain,
          publisherName: null,
          annotations: row.annotations,
        })),
      );
      if (!cursorBlocked) cursor = stamp;
    } catch (err) {
      cursorBlocked = true;
      failures.push(`window ${stamp} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Nothing read at all is a failed run, not a successful run that happened to
  // discover nothing — the distinction an operator reads the status for.
  if (stamps.length > 0 && failures.length === stamps.length) throw new Error(failures.join("; "));

  return { items, cursor, notes: [...notes, ...failures] };
}

// #46. ADR-0018's third surface: on-demand keyword and `theme:` search, one request
// per run. ADR-0024 puts its rows on the same weakest rung as GKG's — the artlist
// response carries no body and no snippet — so what DOC actually contributes is
// *reach*: documents inside GDELT's last ~3 months that no curated feed carries and
// no 15-minute window Tessera happened to be running for.
//
// No cursor. DOC has nothing resumable to hold: the record cap truncates from one
// end of a result set that is re-ranked on every request, so a stamp taken from it
// would name a position no later request can be resumed at. `discovered` and the
// truncation note below are what an operator reads instead.
async function discoverDoc(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  const fetchDoc = deps.fetchDoc ?? httpFetchDocText;
  const articles = parseDocArtList(await fetchDoc(docRequestUrl(connector.endpoint)));
  return {
    cursor: null,
    // The cap is GDELT's and there is no paging past it, so a full response means
    // matches were dropped and the run has to say so — a truncated result set
    // silently reported as a complete one is a claim about coverage we cannot
    // support.
    notes:
      articles.length >= DOC_MAX_RECORDS
        ? [
            `hit the ${DOC_MAX_RECORDS}-record cap: this result set is truncated, not the full ` +
              `match set for the query — narrow the query or shorten its timespan`,
          ]
        : [],
    items: articles.map((article) => ({
      title: article.title,
      link: article.url,
      publishedAt: article.seenAt,
      // ADR-0024: null rather than the title, which is the lie the rung prevents.
      text: null,
      mode: "metadata_only" as const,
      // Tone is GKG's; DOC reports none.
      tone: null,
      // DOC names no publisher beyond the host, which the canonical URL already
      // carries — so the domain names the Publisher, exactly as for a GKG row.
      publisherName: null,
    })),
  };
}

// #47. ADR-0018's fourth surface, and the only one that discovers nothing new: it
// re-reads pages Tessera already holds an excerpt for, to replace that excerpt
// with the body. Every candidate is one discovered item with one outcome, so the
// run's ledger reads exactly as any other connector's — enriched where extraction
// worked, failed where it did not.
//
// The candidate rule is the whole restriction ADR-0018 and #47 exist to impose:
// RSS-discovered, still on the excerpt rung, from a feed explicitly classified
// as lacking bodies, never yet attempted, and from a Publisher whose rights leave
// room for the swap. GKG and DOC rows are excluded twice over — by connector kind
// and by their `metadata_only` rung — because 63k firehose rows a day across 163+
// unknown domains would make this a general-purpose crawler nobody asked for.
async function discoverExtraction(deps: RunConnectorDeps): Promise<Discovery> {
  const fetchPage = deps.fetchPage ?? httpFetchPage;
  const articles = AppDataSource.getRepository(Article);
  const found = await articles
    .createQueryBuilder("article")
    .innerJoin("article.publisher", "publisher")
    .select(["article.id", "article.title", "article.url", "article.publishedAt", "article.analysisText"])
    .where(`article."extractionAttemptedAt" IS NULL`)
    .andWhere(`article."analysisTextMode" = :mode`, { mode: "feed_excerpt" satisfies AnalysisTextMode })
    .andWhere(
      `article."discoveredByConnectorId" IN (
        SELECT id FROM ingestion_connectors
        WHERE kind = :kind AND "feedProvidesFullText" IS FALSE
      )`,
      { kind: "rss" satisfies ConnectorKind },
    )
    .andWhere(`publisher."termsClass" IN (:...termsClasses)`, { termsClasses: EXTRACTABLE_TERMS_CLASSES })
    // Freshest first: a run is capped, so what it spends its attempts on should be
    // the reporting most likely to matter. The attempt mark is what stops a
    // backlog older than the cap from being starved forever.
    .orderBy(`article."createdAt"`, "DESC")
    // One past the cap, so "there is more waiting" is a fact this run read rather
    // than an inference from a full page of results.
    .limit(MAX_EXTRACTION_ATTEMPTS + 1)
    .getMany();
  const candidates = found.slice(0, MAX_EXTRACTION_ATTEMPTS);

  const items: DiscoveredItem[] = [];
  for (const candidate of candidates) {
    // Marked before the fetch, not after it: a page that hangs the process or
    // crashes the run must not be the page every future run starts with.
    await articles.update({ id: candidate.id }, { extractionAttemptedAt: new Date() });
    const held = candidate.analysisText?.length ?? 0;
    let text: string | null = null;
    let failure: string | undefined;
    try {
      const extracted = extractArticleText(await fetchPage(candidate.url));
      // A consent wall, a paywall stub or a nav skeleton — fetched fine, and worth
      // distinguishing from a page that never arrived.
      if (extracted === null) failure = `no readable body at ${candidate.url}`;
      // The ladder is one-way (ADR-0024), so an extraction that is not clearly
      // more than the excerpt would replace it permanently and for nothing.
      else if (extracted.length <= held) failure = `body no longer than the excerpt held for ${candidate.url}`;
      else text = extracted;
    } catch (err) {
      failure = `extraction failed for ${candidate.url}: ${err instanceof Error ? err.message : String(err)}`;
    }
    items.push({
      title: candidate.title,
      link: candidate.url,
      publishedAt: candidate.publishedAt,
      text,
      // ADR-0024: a body Tessera extracted itself, which mayServeText refuses to
      // serve whatever the Publisher's Terms Class (#40) — it is text no
      // publisher handed us.
      mode: "api_content",
      // Tone is GKG's alone.
      tone: null,
      publisherName: null,
      failure,
    });
  }

  return {
    items,
    // No cursor: extraction keeps its place per Article, in
    // `articles.extractionAttemptedAt`, because its backlog is a set of rows rather
    // than a position in a stream.
    cursor: null,
    // Said for the reason #46 states a truncated DOC result set: a run that read
    // its cap's worth is not a run that cleared the backlog, and an operator
    // reading `discovered` alone cannot tell those apart.
    notes:
      found.length > MAX_EXTRACTION_ATTEMPTS
        ? [`hit the ${MAX_EXTRACTION_ATTEMPTS}-page cap: more Articles are waiting for extraction than this run read`]
        : [],
  };
}

async function discover(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  if (connector.kind === "rss") return discoverRss(connector, deps);
  if (connector.kind === "gdelt_gkg") return discoverGkg(connector, deps);
  if (connector.kind === "gdelt_doc") return discoverDoc(connector, deps);
  if (connector.kind === "readability") return discoverExtraction(deps);
  // ADR-0018's four surfaces are all implemented as of #47, so this is reachable
  // only if the `kind` column outgrows the union — and then it is a failed run
  // with a legible reason, not a run that quietly discovers nothing.
  throw new Error(`No connector implementation for kind "${connector.kind}"`);
}

// One item, start to finish. Throws ItemFailure for anything about the item
// itself that makes it unstorable — a feed and a GKG window are both untrusted
// input, so a missing link, an unparseable date or a row with no title is an
// expected outcome that fails the item and not the run.
async function ingestItem(item: DiscoveredItem, connector: IngestionConnector): Promise<ItemOutcome> {
  // Discovery already knows this one cannot be stored (#47), and says why.
  if (item.failure) fail(item.failure);
  // Bound to locals, not read off `item` twice: narrowing a parameter's property
  // does not survive into the transaction callback below.
  const title = item.title;
  if (!title) fail("item has no title");
  if (!item.link) fail("item has no link");
  const url = canonicalizeUrl(item.link);
  if (!url) fail(`item link is not an absolute http(s) URL: ${item.link}`);
  const publishedAt = item.publishedAt;
  if (!publishedAt) fail(`item has no parseable date: ${title}`);
  const text = item.text;
  // Only `metadata_only` may hold no text (ADR-0024). Any other rung with null
  // text is a source that promised text and did not deliver it — a failed item,
  // not a row that quietly claims a rung it cannot support.
  if (text === null && item.mode !== "metadata_only") fail(`item has no analysable text: ${title}`);

  let sourceUrl: URL | null = null;
  if (item.sourceDomain === null) fail(`item has no parseable source domain: ${title}`);
  if (item.sourceDomain !== undefined) {
    try {
      sourceUrl = new URL(`https://${item.sourceDomain}`);
    } catch {
      // Handled by the validation below.
    }
    if (
      !sourceUrl ||
      sourceUrl.username !== "" ||
      sourceUrl.password !== "" ||
      sourceUrl.port !== "" ||
      sourceUrl.pathname !== "/" ||
      sourceUrl.search !== "" ||
      sourceUrl.hash !== "" ||
      !sourceUrl.hostname.includes(".")
    ) {
      fail(`item has no parseable source domain: ${title}`);
    }
  }
  const documentDomain = publisherDomain(url);
  const sourceDomain = sourceUrl ? publisherDomain(sourceUrl.toString()) : null;
  if (sourceDomain && documentDomain !== sourceDomain && !documentDomain.endsWith(`.${sourceDomain}`)) {
    fail(`item source domain ${sourceDomain} is unrelated to document host ${documentDomain}: ${title}`);
  }
  const domain = sourceDomain ?? documentDomain;
  // ponytail: serialize the same normalized title/day across all Publishers so
  // apex/subdomain aliases share the duplicate lock. A canonical PublisherAlias
  // identity can narrow this lock if same-headline contention becomes measurable.
  const dedupeKey = `${publishedAt.toISOString().slice(0, 10)}\n${normalizeTitle(title)}`;

  return AppDataSource.transaction(async (manager) => {
    // The issue-defined duplicate identity has no stored normalized-title
    // column. A transaction-scoped lock makes its check+insert atomic without
    // adding duplicate schema solely for one write path.
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [dedupeKey]);
    const articles = manager.getRepository(Article);
    const held = await articles.findOne({
      where: { url },
      select: { id: true, publisherId: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
    if (held) {
      const sourcePublisher =
        sourceDomain === null ? null : await resolvePublisher(manager, sourceDomain, item.publisherName ?? sourceDomain);
      return reconcileAndStage(manager, held, item, connector.id, text, sourcePublisher?.id ?? null);
    }

    const existingPublisher = await manager.getRepository(Publisher).findOneBy({ domain });
    if (text !== null && existingPublisher && !mayStoreText(existingPublisher.termsClass)) {
      return "rejectedByPolicy";
    }
    if (await findDuplicateId(manager, domain, title, publishedAt)) return "duplicate";

    const publisher = await resolvePublisher(manager, domain, item.publisherName ?? domain);
    // The rights gate (#40). On inserts the discovered Publisher decides; held
    // Articles are checked against the Publisher they retain in reconcileWithHeld.
    if (text !== null && !mayStoreText(publisher.termsClass)) return "rejectedByPolicy";

    const inserted = await articles
      .createQueryBuilder()
      .insert()
      .values({
        // CONTEXT.md "Unclustered Article": ingestion never assigns a Story.
        storyId: null,
        publisherId: publisher.id,
        discoveredByConnectorId: connector.id,
        title,
        url,
        analysisText: text,
        analysisTextMode: item.mode,
        tone: item.tone,
        publishedAt,
      })
      .orIgnore()
      .returning(["id"])
      .execute();
    if (inserted.raw.length > 0) {
      await stageAnnotations(manager, inserted.raw[0].id, item.annotations);
      return "inserted";
    }

    // A differently-titled item can use a different advisory lock while racing
    // on the same canonical URL. ON CONFLICT keeps the transaction usable so we
    // can reconcile with the winner instead of losing either contribution.
    const raced = await articles.findOne({
      where: { url },
      select: { id: true, publisherId: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
    if (!raced) throw new Error(`Article insert was ignored without a canonical URL conflict: ${url}`);
    return reconcileAndStage(manager, raced, item, connector.id, text, sourceDomain === null ? null : publisher.id);
  });
}

// Returns null when the connector is disabled: it did not run, so there is no
// IngestionRun to record. The last of the three places that rule is enforced —
// the Admin trigger refuses immediately (routes/ingestion.ts) and the tick skips
// it (ingestion/jobs.ts) — and the only one that cannot be bypassed, which is what
// makes it the rule: a connector disabled after its job was enqueued still runs
// nothing.
export async function runConnector(
  connector: IngestionConnector,
  deps: RunConnectorDeps,
): Promise<IngestionRun | null> {
  if (!connector.enabled) return null;

  const runs = AppDataSource.getRepository(IngestionRun);
  const run = await runs.save({
    connectorId: connector.id,
    status: "running" as const,
    startedAt: new Date(),
  });

  const counters: Counters = { inserted: 0, enriched: 0, duplicate: 0, rejectedByPolicy: 0, failed: 0 };
  const itemFailures = new Set<string>();
  let discovered = 0;
  let cursor: string | null = null;
  // Discovery-level faults, as against the per-item ones below: a gap skipped for
  // being past the cap, or a window that would not download (#45). Both belong on
  // errorSummary with the item failures — it is the one field the Admin console
  // states a run's reasons on.
  let notes: string[] = [];

  try {
    const discovery = await discover(connector, deps);
    cursor = discovery.cursor;
    notes = discovery.notes ?? [];
    discovered = discovery.items.length;

    for (const item of discovery.items) {
      try {
        counters[await ingestItem(item, connector)] += 1;
      } catch (err) {
        if (!(err instanceof ItemFailure)) throw err;
        counters.failed += 1;
        if (itemFailures.size < MAX_REPORTED_ITEM_FAILURES) {
          itemFailures.add(err.message);
        }
      }
    }

    const summary = [...notes, ...itemFailures];
    await runs.update(
      { id: run.id },
      {
        status: "succeeded",
        completedAt: new Date(),
        discovered,
        ...counters,
        cursor,
        errorSummary: summary.length > 0 ? summary.join("; ") : null,
      },
    );
  } catch (err) {
    // Anything discovered but not yet classified when the run itself fails is a
    // failed item too: every persisted run keeps one outcome per discovery.
    counters.failed += discovered - Object.values(counters).reduce((sum, count) => sum + count, 0);
    await runs.update(
      { id: run.id },
      {
        status: "failed",
        completedAt: new Date(),
        discovered,
        ...counters,
        cursor,
        errorSummary: [...notes, err instanceof Error ? err.message : String(err)].join("; "),
      },
    );
  }

  return runs.findOneByOrFail({ id: run.id });
}
