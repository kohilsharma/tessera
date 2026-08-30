import { IsNull, type EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article, isStrongerAnalysisTextMode } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";
import { IngestionConnector } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { Publisher, mayStoreText } from "../entities/Publisher";
import { canonicalizeUrl, normalizeTitle, publisherDomain } from "./canonicalUrl";
import { parseGkgCsv, readGkgArchive, resolveGkgWindowUrl } from "./gkg";
import { parseRssFeed } from "./rss";

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
// always inject.
export type RunConnectorDeps = { fetchText: FetchText; fetchBytes?: FetchBytes };

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
async function resolvePublisher(domain: string, name: string): Promise<Publisher> {
  const publishers = AppDataSource.getRepository(Publisher);
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
// ponytail: candidates are fetched by publisher and calendar day and compared in
// memory — there is no normalized-title column to index, and one publisher's
// output for one day is a handful of rows. If that stops being true, the upgrade
// is a generated normalized-title column with an index on (publisherId, day).
async function findDuplicateId(
  manager: EntityManager,
  publisherId: string,
  title: string,
  publishedAt: Date,
): Promise<string | null> {
  const [dayStart, nextDay] = utcDayBounds(publishedAt);
  const candidates = await manager
    .getRepository(Article)
    .createQueryBuilder("article")
    .select(["article.id", "article.title"])
    .where("article.publisherId = :publisherId", { publisherId })
    .andWhere(`article."publishedAt" >= :dayStart`, { dayStart })
    .andWhere(`article."publishedAt" < :nextDay`, { nextDay })
    .getMany();
  const normalized = normalizeTitle(title);
  return candidates.find((candidate) => normalizeTitle(candidate.title) === normalized)?.id ?? null;
}

type HeldArticle = {
  id: string;
  analysisTextMode: AnalysisTextMode;
  discoveredByConnectorId: string | null;
};

// A same-URL sighting enriches only when it persists stronger text. Equal or
// weaker sightings contribute nothing and are duplicates, regardless of which
// connector saw them (CONTEXT.md "Enrichment").
// `text` is nullable because a `metadata_only` sighting has none — and because
// that rung is the weakest, such a sighting can never clear the loop's condition,
// so the update below only ever writes text that exists.
async function reconcileWithHeld(
  manager: EntityManager,
  held: HeldArticle,
  connectorId: string,
  text: string | null,
  mode: AnalysisTextMode,
): Promise<ItemOutcome> {
  const articles = manager.getRepository(Article);
  let current = held;
  while (isStrongerAnalysisTextMode(mode, current.analysisTextMode)) {
    // Compare-and-set the rung: concurrent sightings may hold different dedupe
    // locks, so only the transaction that still sees this exact mode may count
    // the transition as enrichment.
    const updated = await articles
      .createQueryBuilder()
      .update()
      .set({
        analysisText: text,
        analysisTextMode: mode,
        discoveredByConnectorId: current.discoveredByConnectorId ?? connectorId,
      })
      .where(`id = :id AND "analysisTextMode" = :heldMode`, {
        id: current.id,
        heldMode: current.analysisTextMode,
      })
      .execute();
    if (updated.affected === 1) return "enriched";

    current = await articles.findOneOrFail({
      where: { id: current.id },
      select: { id: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
  }
  return "duplicate";
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
  // The publisher's display name where the source gives one. Null lets the domain
  // name it — GKG supplies nothing better, and a Publisher is keyed on domain
  // regardless.
  publisherName: string | null;
};

// A run's whole discovery step: the items it found, plus the nearest thing the
// source has to a cursor.
type Discovery = { items: DiscoveredItem[]; cursor: string | null };

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

// ADR-0018: poll `lastupdate.txt`, take the current 15-minute GKG window, and turn
// its rows into Articles. ADR-0024: GKG has no body and no snippet at all, so
// every row is the ladder's weakest rung — `metadata_only`, with genuinely null
// text rather than a title copied into the text column, which is the lie the rung
// was added to prevent.
async function discoverGkg(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  const window = resolveGkgWindowUrl(await deps.fetchText(connector.endpoint), connector.endpoint);
  const csv = readGkgArchive(await (deps.fetchBytes ?? httpFetchBytes)(window.url));
  return {
    cursor: window.stamp,
    items: parseGkgCsv(csv).map((row) => ({
      title: row.title,
      link: row.documentIdentifier,
      publishedAt: row.publishedAt,
      text: null,
      mode: "metadata_only",
      tone: row.tone,
      // GKG's own source name is a bare domain, and where it differs from the
      // document's host it is the *coarser* of the two (`indiatimes.com` for a
      // `timesofindia.indiatimes.com` URL). The URL host is what an Article links
      // to, so both connectors key their Publisher the same way.
      publisherName: null,
    })),
  };
}

async function discover(connector: IngestionConnector, deps: RunConnectorDeps): Promise<Discovery> {
  // #46 adds gdelt_doc here. Until then an unimplemented kind is a failed run
  // with a legible reason, not a run that quietly discovers nothing.
  if (connector.kind === "rss") return discoverRss(connector, deps);
  if (connector.kind === "gdelt_gkg") return discoverGkg(connector, deps);
  throw new Error(`No connector implementation for kind "${connector.kind}"`);
}

// One item, start to finish. Throws ItemFailure for anything about the item
// itself that makes it unstorable — a feed and a GKG window are both untrusted
// input, so a missing link, an unparseable date or a row with no title is an
// expected outcome that fails the item and not the run.
async function ingestItem(item: DiscoveredItem, connector: IngestionConnector): Promise<ItemOutcome> {
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

  const domain = publisherDomain(url);
  const publisher = await resolvePublisher(domain, item.publisherName ?? domain);
  // The rights gate (#40). A publisher classed `open_metadata` has cleared its
  // metadata and nothing else, so text it did not clear is not kept at all: the
  // item goes with its text rather than landing as a text-free row. Rejected on
  // rights grounds and counted, which is what an operator reads that counter for.
  // A text-free sighting has nothing to reject and is unaffected — that is the
  // `metadata_only` rung, whose whole contribution is metadata.
  if (text !== null && !mayStoreText(publisher.termsClass)) return "rejectedByPolicy";
  const dedupeKey = `${publisher.id}\n${publishedAt.toISOString().slice(0, 10)}\n${normalizeTitle(title)}`;

  return AppDataSource.transaction(async (manager) => {
    // The issue-defined duplicate identity has no stored normalized-title
    // column. A transaction-scoped lock makes its check+insert atomic without
    // adding duplicate schema solely for one write path.
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [dedupeKey]);
    const articles = manager.getRepository(Article);
    const held = await articles.findOne({
      where: { url },
      select: { id: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
    if (held) {
      // ADR-0024 §4: a same-URL sighting is one document seen by two instruments,
      // so it contributes what it carries even when its rung is too weak to
      // enrich. Tone is that contribution today (GKG reports it, RSS does not; #43
      // adds the GKG Annotations) — written only where the row holds none, so
      // neither arrival order loses it and neither overwrites the other.
      if (item.tone !== null) await articles.update({ id: held.id, tone: IsNull() }, { tone: item.tone });
      // A text-free newcomer can never be stronger than what is held, so it is
      // counted as a duplicate.
      return reconcileWithHeld(manager, held, connector.id, text, item.mode);
    }

    if (await findDuplicateId(manager, publisher.id, title, publishedAt)) return "duplicate";

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
    if (inserted.raw.length > 0) return "inserted";

    // A differently-titled item can use a different advisory lock while racing
    // on the same canonical URL. ON CONFLICT keeps the transaction usable so we
    // can reconcile with the winner instead of losing either contribution.
    const raced = await articles.findOne({
      where: { url },
      select: { id: true, analysisTextMode: true, discoveredByConnectorId: true },
    });
    if (!raced) throw new Error(`Article insert was ignored without a canonical URL conflict: ${url}`);
    return reconcileWithHeld(manager, raced, connector.id, text, item.mode);
  });
}

// Returns null when the connector is disabled: it did not run, so there is no
// IngestionRun to record. One rule in one place — the Admin trigger and, from
// #42, the scheduler both go through here, so neither can run a disabled feed.
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

  try {
    const discovery = await discover(connector, deps);
    cursor = discovery.cursor;
    discovered = discovery.items.length;

    for (const item of discovery.items) {
      try {
        counters[await ingestItem(item, connector)] += 1;
      } catch (err) {
        counters.failed += 1;
        if (itemFailures.size < MAX_REPORTED_ITEM_FAILURES) {
          itemFailures.add(err instanceof Error ? err.message : String(err));
        }
        // An unexpected error (not an ItemFailure) is a bug rather than bad
        // input, so it is worth a log line as well as a counter.
        if (!(err instanceof ItemFailure)) console.error(`[ingestion] item failed unexpectedly`, err);
      }
    }

    await runs.update(
      { id: run.id },
      {
        status: "succeeded",
        completedAt: new Date(),
        discovered,
        ...counters,
        cursor,
        errorSummary: itemFailures.size > 0 ? [...itemFailures].join("; ") : null,
      },
    );
  } catch (err) {
    // The run itself failed — an unreachable feed, a body that is not RSS. The
    // counters keep whatever was accumulated before the failure so a partial run
    // is still legible.
    await runs.update(
      { id: run.id },
      {
        status: "failed",
        completedAt: new Date(),
        discovered,
        ...counters,
        cursor,
        errorSummary: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return runs.findOneByOrFail({ id: run.id });
}
