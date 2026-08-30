import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article, isStrongerAnalysisTextMode } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";
import { IngestionConnector } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { Publisher, mayStoreText } from "../entities/Publisher";
import { canonicalizeUrl, normalizeTitle, publisherDomain } from "./canonicalUrl";
import { parseRssFeed, type FeedItem } from "./rss";

// The one new seam in Phase 2 (#38): a plain async function taking the connector
// and its dependencies, returning the IngestionRun it persisted. Everything below
// it — fetching, parsing, URL normalization, duplicate matching, enrichment,
// counter accumulation — is internal and deliberately has no seam of its own, so
// tests survive the pipeline being reorganised.
//
// The injected fetcher is what lets the whole pipeline be tested against
// committed real feeds with no network access.
export type FetchText = (url: string) => Promise<string>;

export type RunConnectorDeps = { fetchText: FetchText };

const FETCH_TIMEOUT_MS = 15_000;

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
  return publishers.findOneByOrFail({ domain });
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
async function reconcileWithHeld(
  manager: EntityManager,
  held: HeldArticle,
  connectorId: string,
  text: string,
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

// One item, start to finish. Throws ItemFailure for anything about the item
// itself that makes it unstorable — a feed is untrusted input, so a missing link,
// an unparseable date or a body-less entry is an expected outcome that fails the
// item and not the run.
async function ingestItem(
  item: FeedItem,
  connector: IngestionConnector,
  // The feed's channel title, which is where a Publisher's name comes from. Null
  // for a feed that carries none, and then the domain names the publisher — never
  // an empty string.
  channelTitle: string | null,
): Promise<ItemOutcome> {
  if (!item.title) fail("item has no title");
  if (!item.link) fail("item has no link");
  const url = canonicalizeUrl(item.link);
  if (!url) fail(`item link is not an absolute http(s) URL: ${item.link}`);
  const publishedAt = item.publishedAt;
  if (!publishedAt) fail(`item has no parseable date: ${item.title}`);
  const text = item.text;
  if (!text) fail(`item has no description or content:encoded: ${item.title}`);

  const mode: AnalysisTextMode = "feed_excerpt";
  const domain = publisherDomain(url);
  const publisher = await resolvePublisher(domain, channelTitle ?? domain);
  // The rights gate (#40). A publisher classed `open_metadata` has cleared its
  // metadata and nothing else, and an RSS item's whole contribution is its
  // excerpt — so there is nothing here Tessera may keep, and the item goes with
  // its text rather than landing as a text-free row. Rejected on rights grounds
  // and counted, which is what an operator reads that counter for.
  // (A text-free sighting is unaffected: the metadata_only rung is #41's path,
  // where there is no text to reject.)
  if (!mayStoreText(publisher.termsClass)) return "rejectedByPolicy";
  const dedupeKey = `${publisher.id}\n${publishedAt.toISOString().slice(0, 10)}\n${normalizeTitle(item.title)}`;

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
    if (held) return reconcileWithHeld(manager, held, connector.id, text, mode);

    if (await findDuplicateId(manager, publisher.id, item.title, publishedAt)) return "duplicate";

    const inserted = await articles
      .createQueryBuilder()
      .insert()
      .values({
        // CONTEXT.md "Unclustered Article": ingestion never assigns a Story.
        storyId: null,
        publisherId: publisher.id,
        discoveredByConnectorId: connector.id,
        title: item.title,
        url,
        analysisText: text,
        analysisTextMode: mode,
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
    return reconcileWithHeld(manager, raced, connector.id, text, mode);
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
    // Later tickets widen this path rather than opening a new one: #41 adds
    // gdelt_gkg, #46 adds gdelt_doc. Until then an unimplemented kind is a
    // failed run with a legible reason, not a run that quietly discovers nothing.
    if (connector.kind !== "rss") throw new Error(`No connector implementation for kind "${connector.kind}"`);

    const feed = parseRssFeed(await deps.fetchText(connector.endpoint));
    cursor = feed.lastBuildDate;
    discovered = feed.items.length;

    for (const item of feed.items) {
      try {
        counters[await ingestItem(item, connector, feed.channelTitle)] += 1;
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
