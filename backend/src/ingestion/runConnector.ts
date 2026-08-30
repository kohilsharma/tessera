import { AppDataSource } from "../data-source";
import { Article, isStrongerAnalysisTextMode } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";
import { IngestionConnector } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { Publisher } from "../entities/Publisher";
import { isPgError, PG_UNIQUE_VIOLATION } from "../lib/pgError";
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
// (#40 is what gives a new Publisher its Terms Class, defaulting to
// internal_only so the rights gate fails closed.)
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
async function findDuplicateId(publisherId: string, title: string, publishedAt: Date): Promise<string | null> {
  const [dayStart, nextDay] = utcDayBounds(publishedAt);
  const candidates = await AppDataSource.getRepository(Article)
    .createQueryBuilder("article")
    .select(["article.id", "article.title"])
    .where("article.publisherId = :publisherId", { publisherId })
    .andWhere(`article."publishedAt" >= :dayStart`, { dayStart })
    .andWhere(`article."publishedAt" < :nextDay`, { nextDay })
    .getMany();
  const normalized = normalizeTitle(title);
  return candidates.find((candidate) => normalizeTitle(candidate.title) === normalized)?.id ?? null;
}

type HeldArticle = { id: string; analysisTextMode: AnalysisTextMode };

// ADR-0024: same canonical URL is *enrichment*, not duplication — one document
// seen by two instruments. It counts as enriched only when the newcomer actually
// contributed: text further up the ladder. A sighting that contributes nothing
// (re-running an unchanged feed, most commonly) is a Duplicate, because an
// `enriched` counter that ticks for no-ops tells an operator nothing.
async function reconcileWithHeld(held: HeldArticle, text: string, mode: AnalysisTextMode): Promise<ItemOutcome> {
  if (!isStrongerAnalysisTextMode(mode, held.analysisTextMode)) return "duplicate";
  await AppDataSource.getRepository(Article).update(
    { id: held.id },
    { analysisText: text, analysisTextMode: mode },
  );
  return "enriched";
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
  const articles = AppDataSource.getRepository(Article);

  if (!item.title) fail("item has no title");
  if (!item.link) fail("item has no link");
  const url = canonicalizeUrl(item.link);
  if (!url) fail(`item link is not an absolute http(s) URL: ${item.link}`);
  if (!item.publishedAt) fail(`item has no parseable date: ${item.title}`);
  // No metadata_only rung exists yet (it arrives with the GKG connector, #41),
  // and analysisText is still NOT NULL — so an RSS item with neither
  // content:encoded nor description has nowhere to land.
  if (!item.text) fail(`item has no description or content:encoded: ${item.title}`);

  const mode: AnalysisTextMode = "feed_excerpt";
  const domain = publisherDomain(url);
  const publisher = await resolvePublisher(domain, channelTitle ?? domain);

  const held = await articles.findOne({ where: { url }, select: { id: true, analysisTextMode: true } });
  if (held) return reconcileWithHeld(held, item.text, mode);

  if (await findDuplicateId(publisher.id, item.title, item.publishedAt)) return "duplicate";

  try {
    await articles.insert({
      // CONTEXT.md "Unclustered Article": ingestion never assigns a Story.
      // Phase 3 clustering is what fills this in.
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: connector.id,
      title: item.title,
      url,
      analysisText: item.text,
      analysisTextMode: mode,
      publishedAt: item.publishedAt,
    });
    return "inserted";
  } catch (err) {
    if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
    // Another connector inserted this canonical URL between the read above and
    // this write. Re-read it and make the same decision the non-racing path
    // makes, rather than assuming the winner holds no weaker text than ours —
    // once #41 lands, the row that won the race can be `metadata_only`, and
    // assuming would discard the excerpt (epic story 23: no connector's
    // contribution is lost to a race).
    const raced = await articles.findOneOrFail({ where: { url }, select: { id: true, analysisTextMode: true } });
    return reconcileWithHeld(raced, item.text, mode);
  }
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
