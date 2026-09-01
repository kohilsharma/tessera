import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { strToU8, zipSync } from "fflate";
import { IsNull } from "typeorm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { Article, isStrongerAnalysisTextMode } from "../src/entities/Article";
import type { AnalysisTextMode } from "../src/entities/Article";
import { GkgAnnotation } from "../src/entities/GkgAnnotation";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { IngestionRun } from "../src/entities/IngestionRun";
import { IntelligenceBrief } from "../src/entities/IntelligenceBrief";
import { Publisher, mayServeText } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User } from "../src/entities/User";
import { signToken } from "../src/auth/jwt";
import { canonicalizeUrl, publisherDomain } from "../src/ingestion/canonicalUrl";
import { DOC_MAX_RECORDS } from "../src/ingestion/doc";
import { parseGkgCsv } from "../src/ingestion/gkg";
import { runIngestionJob } from "../src/ingestion/jobs";
import { RUN_JOB, TICK_JOB } from "../src/ingestion/queue";
import { GDELT_RETENTION_DAYS, pruneExpiredGdeltArticles } from "../src/ingestion/retention";
import {
  DOC_MIN_INTERVAL_MS,
  EXTRACTION_MIN_DOMAIN_INTERVAL_MS,
  MAX_EXTRACTION_ATTEMPTS,
  runConnector,
  spaceDocRequest,
  spaceExtractionRequest,
  type FetchText,
  type RunConnectorDeps,
} from "../src/ingestion/runConnector";
import { SEED_CONNECTORS } from "../src/seedData/corpus";
import { setupTestDb } from "./setupTestDb";

// #42: Redis is deliberately not in the test stack — the suite needs only the
// Postgres container — so the one enqueue call is recorded here instead. What that
// leaves untested is bullmq's own behaviour (a job id that already exists is not
// added, which is what makes a second trigger mid-run a no-op); what it does test
// is everything either execution path does either side of the queue.
const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../src/ingestion/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ingestion/queue")>()),
  enqueueConnectorRun: async (connectorId: string) => void enqueued.push(connectorId),
}));

setupTestDb();

const app = () => createApp();

// Seam 1's injected fetcher: committed captures of real feeds, so parsing is
// proven against real escaping (`&apos;`), real CDATA, real tracking parameters
// and real `content:encoded` — with no network access.
const fixture =
  (name: string): FetchText =>
  () =>
    readFile(join(__dirname, "fixtures", "rss", name), "utf-8");

// The GKG equivalent: GDELT's own `lastupdate.txt` line, and a committed slice of
// the live window it names, zipped the way GDELT ships it. Both fetchers are
// injected, so a GKG run is exercised end to end offline.
const GKG_LAST_UPDATE =
  "3066848 98f668dc83aa84d1942c973fc5fcf07c http://data.gdeltproject.org/gdeltv2/20260830190000.gkg.csv.zip";

const gkgFixture = (name: string): RunConnectorDeps => ({
  fetchText: async () => GKG_LAST_UPDATE,
  fetchBytes: async () =>
    zipSync({
      "20260830190000.gkg.csv": strToU8(await readFile(join(__dirname, "fixtures", "gkg", name), "utf-8")),
    }),
});

const failingFetch: FetchText = () => Promise.reject(new Error("getaddrinfo ENOTFOUND feed.invalid"));

// #46. The DOC API's own artlist responses, captured live on 2026-08-31: a
// five-record one and a full 250-record one. Both are read through `fetchDoc`
// rather than `fetchText`, because the DOC API demands its own caller identity and
// pacing — and passing a fetcher that refuses to be called is how each DOC test
// also proves the connector never reaches for the feed one.
const unusedFetch: FetchText = () =>
  Promise.reject(new Error("the DOC connector must not use the feed fetcher"));

const docFixture = (name: string): RunConnectorDeps => ({
  fetchText: unusedFetch,
  fetchDoc: () => readFile(join(__dirname, "fixtures", "doc", name), "utf-8"),
});

// The seeded connector's own endpoint, so what these tests drive and what the demo
// configures cannot drift.
const DOC_ENDPOINT = SEED_CONNECTORS.find((connector) => connector.kind === "gdelt_doc")!.endpoint;

let nextConnector = 0;

async function createRssConnector(
  endpoint: string,
  enabled = true,
  feedProvidesFullText = false,
): Promise<IngestionConnector> {
  nextConnector += 1;
  return AppDataSource.getRepository(IngestionConnector).save({
    name: `Test RSS ${nextConnector}`,
    kind: "rss",
    endpoint,
    enabled,
    feedProvidesFullText,
  });
}

async function createGkgConnector(): Promise<IngestionConnector> {
  nextConnector += 1;
  return AppDataSource.getRepository(IngestionConnector).save({
    name: `Test GKG ${nextConnector}`,
    kind: "gdelt_gkg",
    endpoint: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
    enabled: true,
  });
}

async function createDocConnector(endpoint = DOC_ENDPOINT): Promise<IngestionConnector> {
  nextConnector += 1;
  return AppDataSource.getRepository(IngestionConnector).save({
    name: `Test DOC ${nextConnector}`,
    kind: "gdelt_doc",
    endpoint,
    enabled: true,
  });
}

async function createAdminToken(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  const user = await AppDataSource.getRepository(User).save({ email, passwordHash, role: "admin" });
  return signToken({ sub: user.id, role: user.role });
}

async function registerAndLogin(email: string, role: "student" | "investor"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

// Every discovered item must end in exactly one counter, or an operator reading a
// run is reading a number that means nothing.
function countersSumToDiscovered(run: IngestionRun): boolean {
  return (
    run.inserted + run.enriched + run.duplicate + run.rejectedByPolicy + run.failed === run.discovered
  );
}

// #44: the same ledger invariant for *every* run the suite persists, not only the
// ones a test thought to check.
afterEach(async () => {
  const offenders = await AppDataSource.query(
    `SELECT id, status, discovered, inserted, enriched, duplicate, "rejectedByPolicy", failed
       FROM ingestion_runs
      WHERE inserted + enriched + duplicate + "rejectedByPolicy" + failed <> discovered`,
  );
  expect(offenders).toEqual([]);
});

// ADR-0024's ordered ladder, checked directly: `manual_fixture` sits *outside* it,
// which is the whole reason it is unranked — our own synthetic seed text must not
// be climbable by anything a publisher hands us.
describe("Analysis Text Mode ladder", () => {
  it("orders the ladder upward only and never ranks manual_fixture", () => {
    expect(isStrongerAnalysisTextMode("feed_excerpt", "metadata_only")).toBe(true);
    expect(isStrongerAnalysisTextMode("api_content", "feed_excerpt")).toBe(true);
    expect(isStrongerAnalysisTextMode("licensed_full_text", "api_content")).toBe(true);
    expect(isStrongerAnalysisTextMode("metadata_only", "feed_excerpt")).toBe(false);
    expect(isStrongerAnalysisTextMode("feed_excerpt", "api_content")).toBe(false);
    expect(isStrongerAnalysisTextMode("feed_excerpt", "feed_excerpt")).toBe(false);
    expect(isStrongerAnalysisTextMode("licensed_full_text", "manual_fixture")).toBe(false);
    expect(isStrongerAnalysisTextMode("manual_fixture", "feed_excerpt")).toBe(false);
  });
});

describe("canonical URL", () => {
  it("strips tracking parameters, fragments and trailing slashes, and keeps real ones", () => {
    // The `at_medium`/`at_campaign` pair is what the committed BBC capture
    // actually carries.
    expect(canonicalizeUrl("https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&at_campaign=rss")).toBe(
      "https://www.bbc.co.uk/news/articles/abc",
    );
    expect(canonicalizeUrl("https://example.com/story/#0")).toBe("https://example.com/story");
    expect(canonicalizeUrl("https://example.com/?utm_source=feed&id=7")).toBe("https://example.com/?id=7");
    expect(canonicalizeUrl("https://example.com/a?b=2&a=1")).toBe(canonicalizeUrl("https://example.com/a?a=1&b=2"));
    expect(canonicalizeUrl("/news/articles/abc")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  // The host is left as the publisher served it, because the canonical URL is
  // also the outbound link; `www` aliasing is resolved for Publisher identity
  // instead, where nothing navigates to the value.
  it("keeps the host the publisher linked, and keys Publishers on it without www", () => {
    expect(canonicalizeUrl("https://www.npr.org/2026/08/30/story")).toBe("https://www.npr.org/2026/08/30/story");
    expect(publisherDomain("https://www.npr.org/2026/08/30/story")).toBe("npr.org");
    expect(publisherDomain("https://npr.org/2026/08/30/story")).toBe("npr.org");
  });
});

describe("runConnector over an RSS feed", () => {
  // The committed fixtures are the same real documents in every test here, and a
  // canonical URL is a global identity — so without a reset, the second test to
  // read a fixture sees the first test's rows as duplicates. Connectors are left
  // alone (articles reference them); everything ingestion writes is cleared.
  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  it("lands real reporting as Unclustered Articles and auto-creates their Publisher", async () => {
    const connector = await createRssConnector("https://npr.example/feed.xml");

    const run = await runConnector(connector, { fetchText: fixture("npr-world.xml") });

    expect(run).not.toBeNull();
    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(3);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.completedAt).not.toBeNull();
    // RSS's nearest thing to a cursor is when the publisher last rebuilt the feed.
    expect(run!.cursor).toBe("Sun, 30 Aug 2026 11:23:58 -0400");

    const articles = await AppDataSource.getRepository(Article).find({
      where: { discoveredByConnectorId: connector.id },
      relations: { publisher: true },
    });
    expect(articles).toHaveLength(3);
    for (const article of articles) {
      // The structural invariant: no Story, so every public read path — all of
      // which join through Story — cannot see it (ADR-0007).
      expect(article.storyId).toBeNull();
      expect(article.analysisTextMode).toBe("feed_excerpt");
      expect(article.publisher.domain).toBe("npr.org");
      // Named from the feed's channel title, keyed on the unique domain.
      expect(article.publisher.name).toBe("NPR Topics: World");
      // #40: a Publisher nobody has classified is `internal_only`, so its text is
      // held for analysis and never served — the rights gate fails closed.
      expect(article.publisher.termsClass).toBe("internal_only");
    }

    // content:encoded is HTML in a CDATA block: what lands is the text, not the
    // markup or the tracking pixel the publisher embedded in it.
    const lake = articles.find((article) => article.title.includes("Lake Ontario"));
    expect(lake).toBeDefined();
    expect(lake!.analysisText).not.toContain("<");
    expect(lake!.analysisText).not.toContain("npr-rss-pixel");
    expect(lake!.analysisText).toContain("Ontario Premier Doug Ford");
    // `&apos;` in the real feed's title, decoded rather than stored raw.
    expect(lake!.title).toContain("Trump's");
  });

  it("inserts nothing on a re-run over unchanged source and counts the items as duplicates", async () => {
    const connector = await createRssConnector("https://bbc.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    const first = await runConnector(connector, { fetchText });
    expect(first!.inserted).toBe(3);

    const second = await runConnector(connector, { fetchText });

    expect(second!.status).toBe("succeeded");
    expect(second!.discovered).toBe(3);
    expect(second!.inserted).toBe(0);
    expect(second!.duplicate).toBe(3);
    expect(countersSumToDiscovered(second!)).toBe(true);
    expect(await AppDataSource.getRepository(Article).countBy({ discoveredByConnectorId: connector.id })).toBe(3);
  });

  it("counts cross-connector sightings with no new contribution as duplicates", async () => {
    const firstConnector = await createRssConnector("https://bbc-one.example/feed.xml");
    const secondConnector = await createRssConnector("https://bbc-two.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    expect((await runConnector(firstConnector, { fetchText }))!.inserted).toBe(3);
    const overlap = await runConnector(secondConnector, { fetchText });
    const rerun = await runConnector(secondConnector, { fetchText });

    for (const run of [overlap, rerun]) {
      expect(run!.inserted).toBe(0);
      expect(run!.enriched).toBe(0);
      expect(run!.duplicate).toBe(3);
      expect(countersSumToDiscovered(run!)).toBe(true);
    }
    expect(await AppDataSource.getRepository(Article).count()).toBe(3);
  });

  it("enriches a metadata-only Article when another connector contributes excerpt text", async () => {
    const sourceConnector = await createRssConnector("https://metadata.example/feed.xml");
    const rssConnector = await createRssConnector("https://bbc-enrichment.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: sourceConnector.id,
      title: "Iceland votes against restarting EU membership talks",
      url: "https://www.bbc.co.uk/news/articles/c70le8ed1plo",
      analysisText: null,
      analysisTextMode: "metadata_only",
      publishedAt: new Date("2026-08-30T14:45:05Z"),
    });

    const run = await runConnector(rssConnector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.inserted).toBe(2);
    expect(run!.enriched).toBe(1);
    expect(run!.duplicate).toBe(0);
    const enriched = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(enriched.analysisTextMode).toBe("feed_excerpt");
    expect(enriched.analysisText).toContain("Broadcaster RUV reports");
    expect(enriched.discoveredByConnectorId).toBe(sourceConnector.id);
  });

  it("counts only one concurrent enrichment of the same canonical URL", async () => {
    const concurrency = 8;
    const sourceConnector = await createRssConnector("https://metadata-race.example/feed.xml");
    const connectors = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        createRssConnector(`https://enrichment-race-${index}.example/feed.xml`),
      ),
    );
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Race News",
      domain: "race.example",
    });
    await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: sourceConnector.id,
      title: "Original metadata title",
      url: "https://race.example/shared-report",
      analysisText: null,
      analysisTextMode: "metadata_only",
      publishedAt: new Date("2026-08-30T12:00:00Z"),
    });
    let ready = 0;
    let release!: () => void;
    const allReady = new Promise<void>((resolve) => {
      release = resolve;
    });

    const completed = await Promise.all(
      connectors.map((connector, index) =>
        runConnector(connector, {
          fetchText: async () => {
            ready += 1;
            if (ready === concurrency) release();
            await allReady;
            return `<?xml version="1.0"?><rss version="2.0"><channel><title>Race News</title><item><title>Variant ${index}</title><link>https://race.example/shared-report</link><pubDate>${new Date(Date.UTC(2026, 7, 30 + index)).toUTCString()}</pubDate><description>Excerpt ${index}.</description></item></channel></rss>`;
          },
        }),
      ),
    );

    expect(completed.reduce((sum, run) => sum + run!.enriched, 0)).toBe(1);
    expect(completed.reduce((sum, run) => sum + run!.duplicate, 0)).toBe(concurrency - 1);
    expect(completed.reduce((sum, run) => sum + run!.failed, 0)).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(1);
  });

  it("stores the canonical URL, so a tracked feed link is not a second Article", async () => {
    const connector = await createRssConnector("https://bbc-canonical.example/feed.xml");

    await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    const urls = (
      await AppDataSource.getRepository(Article).find({
        where: { discoveredByConnectorId: connector.id },
        select: { url: true },
      })
    ).map((article) => article.url);
    expect(urls).toContain("https://www.bbc.co.uk/news/articles/c70le8ed1plo");
    expect(urls.every((url) => !url.includes("at_medium"))).toBe(true);
  });

  it("rejects the same reporting at a different canonical URL as a Duplicate", async () => {
    const connector = await createRssConnector("https://bbc-syndicated.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
    });
    // Same reporting, same publisher, same day — re-punctuated and at another URL,
    // which is exactly what normalized-title matching is for.
    await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      title: "Iceland Votes Against Restarting EU Membership Talks!",
      url: "https://bbc.co.uk/news/world-europe-99999999",
      analysisText: "Broadcaster RUV reports the result.",
      analysisTextMode: "feed_excerpt",
      publishedAt: new Date("2026-08-30T09:00:00Z"),
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(2);
    expect(run!.duplicate).toBe(1);
    expect(countersSumToDiscovered(run!)).toBe(true);
  });

  it("atomically rejects concurrent different-URL duplicates", async () => {
    const concurrency = 8;
    const connectors = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        createRssConnector(`https://concurrent-${index}.example/feed.xml`),
      ),
    );
    let ready = 0;
    let release!: () => void;
    const allReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs = connectors.map((connector, index) =>
      runConnector(connector, {
        fetchText: async () => {
          ready += 1;
          if (ready === concurrency) release();
          await allReady;
          return `<?xml version="1.0"?><rss version="2.0"><channel><title>Concurrent News</title><item><title>One shared report</title><link>https://concurrent.example/report-${index}</link><pubDate>Sun, 30 Aug 2026 12:00:00 GMT</pubDate><description>Shared report text.</description></item></channel></rss>`;
        },
      }),
    );

    const completed = await Promise.all(runs);

    expect(completed.reduce((sum, run) => sum + run!.inserted, 0)).toBe(1);
    expect(completed.reduce((sum, run) => sum + run!.duplicate, 0)).toBe(concurrency - 1);
    expect(completed.reduce((sum, run) => sum + run!.failed, 0)).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(1);
  });

  it("never lets a weaker sighting degrade text already held for the same URL", async () => {
    const connector = await createRssConnector("https://bbc-held.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC Held",
      domain: "bbc-held.co.uk",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      title: "Iceland votes against restarting EU membership talks",
      // The canonical form of the first item in the committed BBC capture.
      url: "https://www.bbc.co.uk/news/articles/c70le8ed1plo",
      analysisText: "The licensed full text we already hold.",
      analysisTextMode: "licensed_full_text",
      publishedAt: new Date("2026-08-30T14:45:05Z"),
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.duplicate).toBe(1);
    expect(run!.enriched).toBe(0);
    const after = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(after.analysisTextMode).toBe("licensed_full_text");
    expect(after.analysisText).toBe("The licensed full text we already hold.");
    expect(after.discoveredByConnectorId).toBeNull();
  });

  it("rejects text-bearing items from a metadata-only Publisher on rights grounds", async () => {
    const connector = await createRssConnector("https://bbc-metadata-only.example/feed.xml");
    // Hand-classified: this publisher has cleared its metadata and nothing else,
    // so an RSS excerpt is text Tessera may not keep at all (#40).
    await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
      termsClass: "open_metadata",
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.rejectedByPolicy).toBe(3);
    expect(run!.inserted).toBe(0);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(await AppDataSource.getRepository(Article).count()).toBe(0);
  });

  it("fails a malformed item and not the run, and says why", async () => {
    const connector = await createRssConnector("https://malformed.example/feed.xml");

    const run = await runConnector(connector, { fetchText: fixture("bbc-world-malformed.xml") });

    // One item has no date, one has a site-relative link; the third is intact.
    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(1);
    expect(run!.failed).toBe(2);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.errorSummary).toMatch(/no parseable date/);
    expect(run!.errorSummary).toMatch(/not an absolute http\(s\) URL/);
  });

  // #61. An untouched capture of the live Guardian World feed (2026-09-01): 45
  // items, 153 KB and 2,024 entity references — more than twice fast-xml-parser's
  // default cap on entity expansions *per document*, which is what had failed every
  // run of one of the ten curated feeds since it was seeded. Committed rather than
  // fetched, so the bound that admits it is proven offline.
  it("parses a curated feed carrying more entity references than the parser's default cap", async () => {
    const connector = await createRssConnector("https://www.theguardian.com/world/rss");

    const run = await runConnector(connector, { fetchText: fixture("guardian-world.xml") });

    expect(run!.status).toBe("succeeded");
    expect(run!.errorSummary).toBeNull();
    expect(run!.discovered).toBe(45);
    expect(run!.inserted).toBe(45);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);

    const articles = await AppDataSource.getRepository(Article).find({
      where: { discoveredByConnectorId: connector.id },
      relations: { publisher: true },
    });
    expect(articles).toHaveLength(45);
    // The entities the cap was counting are ordinary punctuation in ordinary
    // headlines, so what proves they were expanded is that none survives raw.
    for (const article of articles) {
      expect(article.title).not.toMatch(/&(amp|#8217|#x27|quot);/);
      expect(article.publisher.domain).toBe("theguardian.com");
    }
  });

  it("loses nothing when two runs race on the same feed", async () => {
    const connector = await createRssConnector("https://race.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    // Both runs read an empty table, so both try to insert all three URLs and the
    // unique constraint is what settles it — the path a real second connector
    // takes when it sights a URL between another's read and write.
    const [first, second] = await Promise.all([
      runConnector(connector, { fetchText }),
      runConnector(connector, { fetchText }),
    ]);

    expect(first!.status).toBe("succeeded");
    expect(second!.status).toBe("succeeded");
    expect(countersSumToDiscovered(first!)).toBe(true);
    expect(countersSumToDiscovered(second!)).toBe(true);
    // Three documents, three rows, and no item lost to the race on either side.
    expect(await AppDataSource.getRepository(Article).count()).toBe(3);
    expect(first!.inserted + second!.inserted).toBe(3);
    expect(first!.failed + second!.failed).toBe(0);
  });

  it("records an unreachable feed as a failed run with an error summary", async () => {
    const connector = await createRssConnector("https://feed.invalid/feed.xml");

    const run = await runConnector(connector, { fetchText: failingFetch });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toContain("ENOTFOUND");
    expect(run!.discovered).toBe(0);
    expect(run!.completedAt).not.toBeNull();
  });

  it("does not run a disabled connector, and records nothing", async () => {
    const connector = await createRssConnector("https://disabled.example/feed.xml", false);

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run).toBeNull();
    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id })).toBe(0);
    expect(await AppDataSource.getRepository(Article).countBy({ discoveredByConnectorId: connector.id })).toBe(0);
  });
});

// #41. GKG carries no body and no snippet at all (ADR-0024), so its rows land on
// the ladder's weakest rung with genuinely null text — the same runConnector seam,
// a different discovery step.
describe("runConnector over a GKG window", () => {
  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  it("lands each row as a metadata_only Unclustered Article with no text", async () => {
    const connector = await createGkgConnector();

    const run = await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(4);
    expect(run!.inserted).toBe(4);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // The 15-minute window this run consumed. #45 turns it into a real cursor.
    expect(run!.cursor).toBe("20260830190000");

    const articles = await AppDataSource.getRepository(Article).find({
      where: { discoveredByConnectorId: connector.id },
      relations: { publisher: true },
    });
    expect(articles).toHaveLength(4);
    for (const article of articles) {
      expect(article.storyId).toBeNull();
      expect(article.analysisTextMode).toBe("metadata_only");
      // ADR-0024: the absence is held as null, never as a copy of the title —
      // which is the lie the rung exists to prevent.
      expect(article.analysisText).toBeNull();
      // Retained for the Phase-3.5 timeline overlay.
      expect(article.tone).not.toBeNull();
      // Auto-created and fail-closed, exactly as for RSS (#40).
      expect(article.publisher.termsClass).toBe("internal_only");
    }
    // One Publisher per GKG source domain, even when the document is served from
    // a more specific host.
    expect(articles.map((article) => article.publisher.domain).sort()).toEqual([
      "indiatimes.com",
      "kdwa.com",
      "thehindu.com",
      "wmuk.org",
    ]);
    const canada = articles.find((article) => article.title.includes("Lake Ontario"));
    expect(canada!.tone).toBeCloseTo(-0.884955752212389, 10);
  });

  it("keeps a text-free Article's searchVector over its title alone", async () => {
    const connector = await createGkgConnector();

    await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));

    // ADR-0024's trap: `tsvector || NULL` is NULL, so a null body without the
    // coalesce would blank the whole vector and drop the row from lexical search
    // silently. The row still has to be *findable by title* — its invisibility to
    // the search endpoint comes from having no Story, not from a broken vector.
    const [{ blank, titleMatches }] = await AppDataSource.query(
      `SELECT COUNT(*) FILTER (WHERE "searchVector" IS NULL)::int AS blank,
              COUNT(*) FILTER (WHERE "searchVector" @@ plainto_tsquery('english', 'Lake Ontario'))::int AS "titleMatches"
       FROM articles WHERE "discoveredByConnectorId" = $1`,
      [connector.id],
    );
    expect(blank).toBe(0);
    expect(titleMatches).toBe(1);
  });

  it("fails a malformed row and not the run, and says why", async () => {
    const connector = await createGkgConnector();

    const run = await runConnector(connector, gkgFixture("20260830190000-malformed.gkg.csv"));

    // One row truncated mid-record (so no V2EXTRASXML and no title), one with an
    // empty document identifier; the third is intact.
    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(1);
    expect(run!.failed).toBe(2);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.errorSummary).toMatch(/no title/);
    expect(run!.errorSummary).toMatch(/no link/);
  });

  it("retries a GKG window after an unexpected persistence failure", async () => {
    const connector = await createGkgConnector();
    const transaction = vi
      .spyOn(AppDataSource, "transaction")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const failed = await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));
    transaction.mockRestore();
    const retry = await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));

    expect(failed!.status).toBe("failed");
    expect(failed!.errorSummary).toContain("database unavailable");
    expect(retry!.discovered).toBe(4);
    expect(retry!.inserted).toBe(4);
  });

  it("fails missing and non-domain GKG source values row by row", async () => {
    const connector = await createGkgConnector();
    const lines = (await readFile(join(__dirname, "fixtures", "gkg", "20260830190000.gkg.csv"), "utf-8")).split("\n");
    for (const [lineIndex, source] of [
      [0, ""],
      [2, "attacker@indiatimes.com"],
      [3, "com"],
    ] as const) {
      const fields = lines[lineIndex].split("\t");
      fields[3] = source;
      lines[lineIndex] = fields.join("\t");
    }

    const run = await runConnector(connector, {
      fetchText: async () => GKG_LAST_UPDATE,
      fetchBytes: async () => zipSync({ "20260830190000.gkg.csv": strToU8(lines.join("\n")) }),
    });

    expect(run!.status).toBe("succeeded");
    expect(run!.inserted).toBe(1);
    expect(run!.failed).toBe(3);
    expect(run!.errorSummary).toMatch(/source domain/);
  });

  it("records a window that is not a GKG file as a failed run", async () => {
    const connector = await createGkgConnector();

    const run = await runConnector(connector, {
      fetchText: async () => "<html>503 Service Unavailable</html>",
      fetchBytes: async () => new Uint8Array(),
    });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toContain(".gkg.csv.zip");
    expect(run!.discovered).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(0);
  });

  it("re-reading rows GDELT carries into a later window inserts nothing", async () => {
    const connector = await createGkgConnector();
    const deps = gkgFixture("20260830190000.gkg.csv");

    expect((await runConnector(connector, deps))!.inserted).toBe(4);
    const staged = await AppDataSource.getRepository(GkgAnnotation).count();
    // The cursor (#45) means one window is never downloaded twice, so the re-read
    // worth proving is the one GDELT actually produces: the same document reported
    // again in the following window.
    const second = await runConnector(connector, {
      fetchText: async () => GKG_LAST_UPDATE.replace("20260830190000", "20260830191500"),
      fetchBytes: deps.fetchBytes,
    });

    expect(second!.inserted).toBe(0);
    expect(second!.duplicate).toBe(4);
    // A metadata_only sighting is the weakest rung, so it can never enrich.
    expect(second!.enriched).toBe(0);
    expect(second!.cursor).toBe("20260830191500");
    expect(await AppDataSource.getRepository(Article).count()).toBe(4);
    // ...and one occurrence is one row, so the second reading of the same rows
    // stages nothing new either (#43). That idempotence is what lets staging run
    // on every sighting rather than only on insert.
    expect(await AppDataSource.getRepository(GkgAnnotation).count()).toBe(staged);
  });

  // #43. CONTEXT.md "GKG Annotation": the pre-resolution raw material Phase 3.5
  // resolves canonical Entities from, staged per Article exactly as GKG reported
  // it.
  it("stages every GKG Annotation against its Article, queryable per Article", async () => {
    const connector = await createGkgConnector();

    await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));

    const annotations = AppDataSource.getRepository(GkgAnnotation);
    expect(await annotations.count()).toBe(273);
    const article = await AppDataSource.getRepository(Article).findOneByOrFail({
      url: "https://www.thehindu.com/news/cities/chennai/the-hindu-in-school-educators-confluence-2026-to-be-held-on-sept-2/article71408318.ece",
    });
    const staged = await annotations.find({
      where: { articleId: article.id },
      order: { kind: "ASC", charOffset: "ASC" },
    });

    expect(staged).toHaveLength(41);
    expect(staged.filter((row) => row.kind === "person").map((row) => row.surfaceName)).toEqual([
      "Lakshmi Vijayakumar",
      "Ramya Venkataraman",
    ]);
    // Locations keep GKG's gazetteer detail; the other three kinds have none.
    expect(staged.find((row) => row.kind === "location")).toMatchObject({
      surfaceName: "Chennai, Tamil Nadu, India",
      charOffset: 85,
      locationDetail: { featureId: "-2103041", countryCode: "IN", latitude: 13.0833, longitude: 80.2833 },
    });
    expect(staged.every((row) => (row.kind === "location") === (row.locationDetail !== null))).toBe(true);
    // Stored as reported: GDELT's title-cased organization and its uppercase
    // taxonomy label both survive the trip, because resolution is Phase 3.5's job
    // and it needs the surface form to resolve *from*.
    expect(staged.map((row) => row.surfaceName)).toContain("Centre For Teacher Accreditation");
    expect(staged.map((row) => row.surfaceName)).toContain("WB_1305_HEALTH_SERVICES_DELIVERY");
  });

  it("persists exact surface names beyond the old index bound idempotently", async () => {
    const connector = await createGkgConnector();
    const fields = (await readFile(join(__dirname, "fixtures", "gkg", "20260830190000.gkg.csv"), "utf-8"))
      .split("\n")[0]
      .split("\t");
    const longName = "A".repeat(513);
    fields[8] = "";
    fields[10] = "";
    fields[12] = `  Reported Person  ,42`;
    fields[14] = `${longName},5`;
    const deps: RunConnectorDeps = {
      fetchText: async () => GKG_LAST_UPDATE,
      fetchBytes: async () => zipSync({ "20260830190000.gkg.csv": strToU8(fields.join("\t")) }),
    };

    await runConnector(connector, deps);

    const annotations = AppDataSource.getRepository(GkgAnnotation);
    expect(
      (await annotations.find({ order: { charOffset: "ASC" } })).map((annotation) => annotation.surfaceName),
    ).toEqual([longName, "  Reported Person  "]);

    await runConnector(connector, deps);
    expect(await annotations.count()).toBe(2);
  });

  it("returns an Article's co-occurring names from a self-join over its annotations", async () => {
    const connector = await createGkgConnector();
    await runConnector(connector, gkgFixture("20260830190000.gkg.csv"));
    const article = await AppDataSource.getRepository(Article).findOneByOrFail({
      url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
    });

    // ADR-0019's co-occurrence edge, as the query that will build it: distinct
    // unordered pairs of person/organization names in one Article. `>` rather
    // than `<>` is what makes a pair one row instead of two.
    const pairs = await AppDataSource.query(
      `SELECT DISTINCT a."surfaceName" AS "nameA", b."surfaceName" AS "nameB"
         FROM gkg_annotations a
         JOIN gkg_annotations b ON b."articleId" = a."articleId" AND b."surfaceName" > a."surfaceName"
        WHERE a."articleId" = $1
          AND a."kind" IN ('person', 'organization')
          AND b."kind" IN ('person', 'organization')
        ORDER BY 1, 2`,
      [article.id],
    );

    expect(pairs).toEqual([
      { nameA: "Campaign For Just", nameB: "National Register Of Citizens" },
      { nameA: "Campaign For Just", nameB: "Yumnam Khemchand Singh" },
      { nameA: "National Register Of Citizens", nameB: "Yumnam Khemchand Singh" },
    ]);
  });

  it("counts a sighting whose only contribution is annotations as an Enrichment", async () => {
    const gkgConnector = await createGkgConnector();
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "India Times",
      domain: "indiatimes.com",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      title: "Manipur CM Khemchand urges people to avoid bandhs amid NRC demand",
      url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      analysisText: null,
      analysisTextMode: "metadata_only",
      // Already held, and already attributed to GKG's own source domain — so
      // neither tone nor Publisher identity is this sighting's contribution. The
      // annotations are the only thing left, and they are enough (CONTEXT.md
      // "Enrichment").
      tone: -1.5,
      publishedAt: new Date("2026-08-30T19:00:00Z"),
    });

    const run = await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));

    expect(run!.enriched).toBe(1);
    expect(run!.duplicate).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(await AppDataSource.getRepository(GkgAnnotation).countBy({ articleId: held.id })).toBe(66);
  });

  it("atomically deduplicates different URLs across GKG apex and RSS subdomain Publishers", async () => {
    const csv = await readFile(join(__dirname, "fixtures", "gkg", "20260830190000.gkg.csv"), "utf-8");
    const gkgRow = parseGkgCsv(csv)[2];
    const gkgConnector = await createGkgConnector();
    const rssConnector = await createRssConnector("https://times.example/feed.xml");

    const [gkgRun, rssRun] = await Promise.all([
      runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv")),
      runConnector(rssConnector, {
        fetchText: async () =>
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Times of India</title><item><title>${gkgRow.title}</title><link>https://timesofindia.indiatimes.com/different-url-for-the-same-report</link><pubDate>${gkgRow.publishedAt!.toUTCString()}</pubDate><description>Feed excerpt.</description></item></channel></rss>`,
      }),
    ]);

    expect(gkgRun!.inserted + rssRun!.inserted).toBe(4);
    expect(gkgRun!.duplicate + rssRun!.duplicate).toBe(1);
    expect(await AppDataSource.getRepository(Article).count()).toBe(4);
  });

  // ADR-0024 §4 (#44): the two connectors constantly discover the same document
  // and each carries what the other lacks — GKG the annotations and tone, RSS the
  // excerpt — so whichever arrives second must enrich rather than insert, reject,
  // or overwrite. Both orderings are driven end to end below against committed
  // GKG and RSS fixtures, so no contribution can be lost to arrival order.
  const wmukUrl =
    "https://www.wmuk.org/npr-news/2026-08-30/canada-claps-back-at-trumps-efforts-to-rename-lake-ontario-as-lake-america";
  const wmukFeed = fixture("wmuk-npr-news.xml");

  it("raises a GKG row to feed_excerpt when RSS sights the same canonical URL second", async () => {
    const gkgConnector = await createGkgConnector();
    const rssConnector = await createRssConnector("https://wmuk.example/feed.xml");
    expect((await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv")))!.inserted).toBe(4);
    const held = await AppDataSource.getRepository(Article).findOneByOrFail({ url: wmukUrl });
    expect(held.analysisTextMode).toBe("metadata_only");
    expect(await AppDataSource.getRepository(GkgAnnotation).countBy({ articleId: held.id })).toBeGreaterThan(0);

    const run = await runConnector(rssConnector, { fetchText: wmukFeed });

    expect(run!.discovered).toBe(1);
    expect(run!.enriched).toBe(1);
    expect(run!.inserted).toBe(0);
    expect(run!.duplicate).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    const after = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(after.analysisTextMode).toBe("feed_excerpt");
    expect(after.analysisText).toContain("Broadcast excerpt");
    // What GKG contributed is untouched by the enrichment, and the sighting made
    // no second Article.
    expect(after.tone).toBeCloseTo(-0.884955752212389, 10);
    expect(await AppDataSource.getRepository(Article).count()).toBe(4);
  });

  it("attaches GKG Annotations to an Article RSS found first, without lowering its mode", async () => {
    const rssConnector = await createRssConnector("https://wmuk.example/feed.xml");
    const gkgConnector = await createGkgConnector();
    expect((await runConnector(rssConnector, { fetchText: wmukFeed }))!.inserted).toBe(1);
    const held = await AppDataSource.getRepository(Article).findOneByOrFail({ url: wmukUrl });
    expect(await AppDataSource.getRepository(GkgAnnotation).countBy({ articleId: held.id })).toBe(0);

    const run = await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));

    expect(run!.discovered).toBe(4);
    expect(run!.inserted).toBe(3);
    expect(run!.enriched).toBe(1);
    expect(run!.duplicate).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(await AppDataSource.getRepository(Article).count()).toBe(4);
    const after = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    // The ladder's weakest rung arriving second takes nothing away: the mode and
    // the excerpt are the feed's, the tone and the annotations are GKG's.
    expect(after.analysisTextMode).toBe("feed_excerpt");
    expect(after.analysisText).toContain("Broadcast excerpt");
    expect(after.tone).toBeCloseTo(-0.884955752212389, 10);
    const annotations = await AppDataSource.getRepository(GkgAnnotation).findBy({ articleId: held.id });
    expect(annotations.some(({ kind, surfaceName }) => kind === "person" && surfaceName === "Doug Ford")).toBe(true);
    expect(annotations.length).toBeGreaterThan(0);
  });

  // ADR-0024 §4: both connectors will constantly hit the same URL and which one
  // arrives first is a race. GKG's source domain and tone must survive the
  // ordering where RSS is first, even when the document host is more specific.
  it("contributes GKG Publisher identity and tone to an Article an RSS feed found first", async () => {
    const rssConnector = await createRssConnector("https://tone-overlap.example/feed.xml");
    const gkgConnector = await createGkgConnector();
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Times of India",
      domain: "timesofindia.indiatimes.com",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: rssConnector.id,
      title: "An RSS headline for the same document",
      url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      analysisText: "An excerpt the feed supplied.",
      analysisTextMode: "feed_excerpt",
      publishedAt: new Date("2026-08-30T19:00:00Z"),
    });

    const run = await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));

    expect(run!.inserted).toBe(3);
    expect(run!.duplicate).toBe(0);
    expect(run!.enriched).toBe(1);
    const after = await AppDataSource.getRepository(Article).findOneOrFail({
      where: { id: held.id },
      relations: { publisher: true },
    });
    expect(after.publisher.domain).toBe("indiatimes.com");
    expect(after.tone).not.toBeNull();
    // The weaker sighting contributed metadata and nothing else: the text and
    // rung the feed supplied are untouched.
    expect(after.analysisTextMode).toBe("feed_excerpt");
    expect(after.analysisText).toBe("An excerpt the feed supplied.");
  });

  it("does not let GKG attribution grant serving rights to held text", async () => {
    const gkgConnector = await createGkgConnector();
    const publishers = AppDataSource.getRepository(Publisher);
    const documentHost = await publishers.save({
      name: "Times of India",
      domain: "timesofindia.indiatimes.com",
    });
    await publishers.save({ name: "India Times", domain: "indiatimes.com", termsClass: "licensed" });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: documentHost.id,
      discoveredByConnectorId: null,
      title: "An RSS headline for the same document",
      url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      analysisText: "Text cleared by the document-host Publisher.",
      analysisTextMode: "feed_excerpt",
      publishedAt: new Date("2026-08-30T19:00:00Z"),
    });

    const run = await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));
    const after = await AppDataSource.getRepository(Article).findOneOrFail({
      where: { id: held.id },
      relations: { publisher: true },
    });

    expect(run!.enriched).toBe(1);
    expect(after.publisher.domain).toBe("timesofindia.indiatimes.com");
    expect(after.analysisText).toBe("Text cleared by the document-host Publisher.");
    expect(after.tone).not.toBeNull();
  });

  it("rejects RSS text when the held GKG source Publisher is open_metadata", async () => {
    await AppDataSource.getRepository(Publisher).save({
      name: "India Times",
      domain: "indiatimes.com",
      termsClass: "open_metadata",
    });
    const gkgConnector = await createGkgConnector();
    await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));

    const rssConnector = await createRssConnector("https://times.example/feed.xml");
    const run = await runConnector(rssConnector, {
      fetchText: async () =>
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Times of India</title><item><title>Same document with text</title><link>https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms</link><pubDate>Sun, 30 Aug 2026 19:00:00 GMT</pubDate><description>Feed excerpt.</description></item></channel></rss>`,
    });
    const article = await AppDataSource.getRepository(Article).findOneOrFail({
      where: {
        url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      },
      relations: { publisher: true },
    });

    expect(run!.rejectedByPolicy).toBe(1);
    expect(run!.enriched).toBe(0);
    expect(article.publisher.domain).toBe("indiatimes.com");
    expect(article.analysisText).toBeNull();
    expect(article.analysisTextMode).toBe("metadata_only");
  });

  it("uses the held source Publisher's terms for RSS enrichment", async () => {
    const publishers = AppDataSource.getRepository(Publisher);
    await publishers.save({ name: "India Times", domain: "indiatimes.com" });
    await publishers.save({
      name: "Times document host",
      domain: "timesofindia.indiatimes.com",
      termsClass: "open_metadata",
    });
    const gkgConnector = await createGkgConnector();
    await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));

    const rssConnector = await createRssConnector("https://times.example/feed.xml");
    const run = await runConnector(rssConnector, {
      fetchText: async () =>
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Times of India</title><item><title>Same document with text</title><link>https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms</link><pubDate>Sun, 30 Aug 2026 19:00:00 GMT</pubDate><description>Feed excerpt.</description></item></channel></rss>`,
    });
    const article = await AppDataSource.getRepository(Article).findOneOrFail({
      where: {
        url: "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      },
      relations: { publisher: true },
    });

    expect(run!.enriched).toBe(1);
    expect(run!.rejectedByPolicy).toBe(0);
    expect(article.publisher.domain).toBe("indiatimes.com");
    expect(article.analysisText).toBe("Feed excerpt.");
  });

  // GKG reports no publisher name, so an RSS channel title should improve the
  // authoritative source Publisher even when the document is served by a subdomain.
  it("applies a feed's channel title to the GKG source Publisher without creating an alias", async () => {
    const gkgConnector = await createGkgConnector();
    await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));
    const publishers = AppDataSource.getRepository(Publisher);
    expect((await publishers.findOneByOrFail({ domain: "indiatimes.com" })).name).toBe("indiatimes.com");

    const rssConnector = await createRssConnector("https://times.example/feed.xml");
    await runConnector(rssConnector, {
      fetchText: async () =>
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Times of India</title><item><title>Same document with text</title><link>https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms</link><pubDate>Sun, 30 Aug 2026 19:00:00 GMT</pubDate><description>Feed excerpt.</description></item></channel></rss>`,
    });

    expect((await publishers.findOneByOrFail({ domain: "indiatimes.com" })).name).toBe("Times of India");
    expect(await publishers.findOneBy({ domain: "timesofindia.indiatimes.com" })).toBeNull();
  });

  // #45. CONTEXT.md "Window Cursor": the worker is not a 24/7 service, so gaps are
  // the normal state. `lastupdate.txt` names only the current window, so the
  // missed ones are named off the 15-minute grid and read before going live.
  describe("catching up on missed windows", () => {
    const windowUrl = (stamp: string) => `http://data.gdeltproject.org/gdeltv2/${stamp}.gkg.csv.zip`;

    // Records what the run asked GDELT for, which is the only way to see that the
    // missed file names were computed rather than looked up.
    function recordingDeps(failing: (url: string) => boolean = () => false) {
      const requested: string[] = [];
      const deps: RunConnectorDeps = {
        fetchText: async () => GKG_LAST_UPDATE,
        fetchBytes: async (url) => {
          requested.push(url);
          if (failing(url)) throw new Error("responded 404");
          const csv = await readFile(join(__dirname, "fixtures", "gkg", "20260830190000.gkg.csv"), "utf-8");
          return zipSync({ "window.gkg.csv": strToU8(csv) });
        },
      };
      return { requested, deps };
    }

    // The cursor is read back off the runs the connector persisted, so a prior
    // window is stated the same way a real run would state it.
    const processedThrough = (connectorId: string, cursor: string) =>
      AppDataSource.getRepository(IngestionRun).save({
        connectorId,
        status: "succeeded" as const,
        startedAt: new Date(),
        completedAt: new Date(),
        cursor,
      });

    it("reads every window missed since its cursor, named arithmetically", async () => {
      const connector = await createGkgConnector();
      await processedThrough(connector.id, "20260830180000");
      const { requested, deps } = recordingDeps();

      const run = await runConnector(connector, deps);

      expect(requested).toEqual([
        windowUrl("20260830181500"),
        windowUrl("20260830183000"),
        windowUrl("20260830184500"),
        windowUrl("20260830190000"),
      ]);
      // `masterfilelist.txt` is 127 MB to learn what modulo already knows — the
      // names above prove it is never needed.
      expect(requested.every((url) => !url.includes("masterfilelist"))).toBe(true);
      expect(run!.status).toBe("succeeded");
      // Four rows per window, all four windows parsed. The fixture is the same
      // reporting each time, so only the first window's rows are new.
      expect(run!.discovered).toBe(16);
      expect(run!.inserted).toBe(4);
      expect(run!.duplicate).toBe(12);
      expect(run!.cursor).toBe("20260830190000");
    });

    it("asks for nothing once its cursor names the window GDELT is publishing", async () => {
      const connector = await createGkgConnector();
      const { requested, deps } = recordingDeps();
      await runConnector(connector, deps);

      const second = await runConnector(connector, deps);

      // The download is what the cursor saves: re-reading a window is idempotent
      // but still 3 MB over the wire for nothing.
      expect(requested).toEqual([windowUrl("20260830190000")]);
      expect(second!.status).toBe("succeeded");
      expect(second!.discovered).toBe(0);
      expect(second!.cursor).toBe("20260830190000");
      // Nothing to read is not a fault, so nothing lands on errorSummary either.
      expect(second!.errorSummary).toBeNull();
    });

    it("skips a gap past the two-hour cap and goes live, saying what it dropped", async () => {
      const connector = await createGkgConnector();
      await processedThrough(connector.id, "20260823190000");
      const { requested, deps } = recordingDeps();

      const run = await runConnector(connector, deps);

      expect(requested).toEqual([windowUrl("20260830190000")]);
      expect(run!.status).toBe("succeeded");
      // Visible on the run rather than only in the log: errorSummary is what the
      // Admin console states for a run that is not what an operator expected.
      expect(run!.errorSummary).toMatch(/skipped 671 missed window\(s\) before 20260830190000/);
      expect(run!.errorSummary).toMatch(/8-window catch-up cap/);
      expect(run!.cursor).toBe("20260830190000");
    });

    it("keeps a failed missed window retryable while continuing the run", async () => {
      const connector = await createGkgConnector();
      await processedThrough(connector.id, "20260830183000");
      const { deps } = recordingDeps((url) => url.includes("20260830184500"));

      const run = await runConnector(connector, deps);

      expect(run!.status).toBe("succeeded");
      expect(run!.errorSummary).toMatch(/window 20260830184500 failed: responded 404/);
      // Later windows may still be ingested, but the cursor stays before the gap
      // so a transient refusal cannot silently lose that window.
      expect(run!.cursor).toBe("20260830183000");
      expect(run!.discovered).toBe(4);
    });

    it("ignores malformed run cursors when choosing where to resume", async () => {
      const connector = await createGkgConnector();
      await processedThrough(connector.id, "20260830183000");
      await processedThrough(connector.id, "20260830185900");
      await processedThrough(connector.id, "Sat, 30 Aug 2026 19:00:00 GMT");
      const { requested, deps } = recordingDeps();

      const run = await runConnector(connector, deps);

      expect(requested).toEqual([windowUrl("20260830184500"), windowUrl("20260830190000")]);
      expect(run!.cursor).toBe("20260830190000");
    });

    it("holds the cursor short of a current window that would not download", async () => {
      const connector = await createGkgConnector();
      await processedThrough(connector.id, "20260830183000");
      const { deps } = recordingDeps((url) => url.includes("20260830190000"));

      const run = await runConnector(connector, deps);

      expect(run!.status).toBe("succeeded");
      expect(run!.errorSummary).toMatch(/window 20260830190000 failed/);
      // Short of the current window, so the next run reads it again — a transient
      // refusal must not lose the window that matters most.
      expect(run!.cursor).toBe("20260830184500");
    });

    it("records a run whose only window would not download as failed", async () => {
      const connector = await createGkgConnector();
      const { deps } = recordingDeps(() => true);

      const run = await runConnector(connector, deps);

      // Nothing read at all is a failed run, not a successful run that discovered
      // nothing — and the cursor stays where it was.
      expect(run!.status).toBe("failed");
      expect(run!.errorSummary).toMatch(/window 20260830190000 failed: responded 404/);
      expect(run!.discovered).toBe(0);
      expect(run!.cursor).toBeNull();
    });
  });
});

// #46. ADR-0018's third surface, and the one that is mostly a parser over machinery
// that already exists: the same run function, the same canonical-URL identity, the
// same dedup and the same enrichment path. What is genuinely new is the request
// (a query the operator owns, a cap GDELT enforces) and the response shape.
//
// The reconcile path is connector-agnostic, so DOC's behaviour when it meets another
// connector's Article is what #44 already drives end to end; what is asserted here
// is everything either side of it.
describe("runConnector over the GDELT DOC API", () => {
  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  it("refuses an endpoint with no query rather than asking GDELT for everything", async () => {
    const connector = await createDocConnector("https://api.gdeltproject.org/api/v2/doc/doc?timespan=1d");

    const run = await runConnector(connector, docFixture("artlist.json"));

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toMatch(/carries no "query" parameter/);
    expect(run!.discovered).toBe(0);
  });

  it("lands real DOC results as text-free Unclustered Articles, deduplicating within the response", async () => {
    const connector = await createDocConnector();

    const run = await runConnector(connector, docFixture("artlist.json"));

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(5);
    // The captured response really does carry the same Motley Fool article twice —
    // once bare, once with a `?source=` referrer tag that survives canonicalization
    // — so the second copy is caught by title + publisher + day, not by URL.
    expect(run!.inserted).toBe(4);
    expect(run!.duplicate).toBe(1);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // DOC has nothing resumable to hold: the cap truncates a result set that is
    // re-ranked on every request.
    expect(run!.cursor).toBeNull();
    expect(run!.errorSummary).toBeNull();

    const articles = await AppDataSource.getRepository(Article).find({
      where: { discoveredByConnectorId: connector.id },
      relations: { publisher: true },
    });
    expect(articles).toHaveLength(4);
    for (const article of articles) {
      expect(article.storyId).toBeNull();
      // ADR-0024: an artlist record carries no body and no snippet, so a DOC row
      // sits on the same weakest rung as a GKG row, with the absence held as null.
      expect(article.analysisTextMode).toBe("metadata_only");
      expect(article.analysisText).toBeNull();
      // Tone is GKG's alone.
      expect(article.tone).toBeNull();
      expect(article.publisher.termsClass).toBe("internal_only");
      // DOC names no publisher beyond the host, so the domain names it.
      expect(article.publisher.name).toBe(article.publisher.domain);
    }
    // The same headline at a second publisher is syndication, not duplication —
    // ADR-0024 leaves it as two legitimate sources.
    expect(articles.map((article) => article.publisher.domain).sort()).toEqual([
      "aol.com",
      "arynews.tv",
      "finance.yahoo.com",
      "fool.com",
    ]);
    // GDELT tokenizes titles, so this spacing is the real surface form. Only the
    // whitespace tokenization left behind is collapsed; guessing which spaces were
    // not in the headline would be guessing.
    expect(articles.map((article) => article.title)).toContain(
      "Not Nvidia . Not AMD . This Semiconductor Giant Will Be the Ultimate Winner of the " +
        "Artificial Intelligence ( AI ) Hardware Race .",
    );
    // `seendate` is when GDELT saw the document — DOC reports no publication time
    // of its own, and inventing one would be a claim the timeline (ADR-0020) then
    // orders by.
    const pakistan = articles.find((article) => article.publisher.domain === "arynews.tv");
    expect(pakistan!.publishedAt.toISOString()).toBe("2026-08-29T16:00:00.000Z");
  });

  it("counts a second connector's DOC sighting as a duplicate, since it can contribute nothing", async () => {
    const first = await createDocConnector();
    const second = await createDocConnector();

    expect((await runConnector(first, docFixture("artlist.json")))!.inserted).toBe(4);
    const run = await runConnector(second, docFixture("artlist.json"));

    // DOC is the only connector whose sighting carries no text, no tone, no
    // annotations and no publisher name — the shape ADR-0024's enrichment rule has
    // to decline. `metadata_only` is the weakest rung, so it can never raise
    // another connector's Article, and an enrichment count that ticked here would
    // tell an operator nothing (CONTEXT.md "Enrichment").
    expect(run!.status).toBe("succeeded");
    expect(run!.inserted).toBe(0);
    expect(run!.enriched).toBe(0);
    expect(run!.duplicate).toBe(5);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // One document, one Article, whichever connector saw it.
    expect(await AppDataSource.getRepository(Article).count()).toBe(4);
    expect(await AppDataSource.getRepository(Article).countBy({ discoveredByConnectorId: second.id })).toBe(0);
  });

  it("states that a full result set is truncated rather than reporting it as complete", async () => {
    const connector = await createDocConnector();

    const run = await runConnector(connector, docFixture("artlist-capped.json"));

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(DOC_MAX_RECORDS);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // GDELT offers no paging cursor past the cap, so the only honest thing a run
    // can do about the matches it did not receive is say they exist.
    expect(run!.errorSummary).toMatch(/250-record cap/);
    expect(run!.errorSummary).toMatch(/truncated/);
    expect(run!.inserted).toBeGreaterThan(0);
  });

  it("fails the run with a readable summary when the API answers with something other than JSON", async () => {
    const connector = await createDocConnector();

    // ADR-0018's warning, as it actually arrives: a caller the DOC API has decided
    // to block gets a 200 and a page, not a status code.
    const run = await runConnector(connector, {
      fetchText: unusedFetch,
      fetchDoc: async () => "<html><head><title>429 Too Many Requests</title></head><body>Rate limited.</body></html>",
    });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toMatch(/non-JSON body/);
    expect(run!.errorSummary).toMatch(/429 Too Many Requests/);
    expect(run!.discovered).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(0);
  });

  it("fails the run gracefully when the request never reaches the API", async () => {
    const connector = await createDocConnector();

    // Measured 2026-09-01 (#60): TLS to the DOC host is reset from the development
    // network path, so there is no body and no status at all — a network-path
    // failure, not GDELT refusing a caller. The connector requests over plaintext
    // for exactly that reason; this is what a run does when even that fails.
    const run = await runConnector(connector, {
      fetchText: unusedFetch,
      fetchDoc: () => Promise.reject(new Error("fetch failed: read ECONNRESET")),
    });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toMatch(/ECONNRESET/);
    expect(run!.completedAt).not.toBeNull();
  });

  it("treats an empty result set as a run that discovered nothing", async () => {
    const connector = await createDocConnector();

    // A well-formed response carrying no records is not a fault — and GDELT writes
    // one of those as bare `{}`, measured against the live API for both a nonsense
    // query and the newest hour, which it has not indexed yet (#60).
    for (const body of [`{"articles": []}`, "{}"]) {
      const run = await runConnector(connector, { fetchText: unusedFetch, fetchDoc: async () => body });

      expect(run!.status).toBe("succeeded");
      expect(run!.discovered).toBe(0);
      expect(run!.errorSummary).toBeNull();
    }
  });

  // ADR-0018: the DOC API blocks a caller that asks too often, and one run is one
  // request — so the pacing has to live between runs, which is what this holds.
  it("spaces consecutive DOC requests by the interval ADR-0018 asks for", async () => {
    vi.useFakeTimers();
    try {
      // Clear whatever spacing an earlier call left claimed, so the assertion is
      // about the gap this test creates.
      await vi.advanceTimersByTimeAsync(DOC_MIN_INTERVAL_MS);
      await spaceDocRequest();

      let released = false;
      const second = spaceDocRequest().then(() => {
        released = true;
      });

      await vi.advanceTimersByTimeAsync(DOC_MIN_INTERVAL_MS - 1);
      expect(released).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await second;
      expect(released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // #60. The one check nothing offline could have made: this connector failed every
  // run for two reasons a fixture cannot express — the request never reached the
  // host, and the window it asked for was one GDELT had not indexed yet. Both are
  // properties of the live request, so the live request is what asserts them; the
  // scheme and the window they argue for are explained in `seedData/corpus.ts`.
  // Opt-in with `GDELT_LIVE_SMOKE=1`, like the parser-shape check in doc.test.ts, so
  // the ordinary suite stays offline and off this rate-limited endpoint — the flag
  // also stops vitest running files in parallel, because both files pace against
  // the same endpoint through a module-level timestamp (`vitest.config.ts`).
  describe.runIf(process.env.GDELT_LIVE_SMOKE === "1")("against the live API", () => {
    it("completes a run and inserts Articles", async () => {
      const connector = await createDocConnector();

      // No injected fetcher: the real one, over the seeded endpoint, with its own
      // pacing. `fetchText` is still required by the deps type and unreachable here.
      const run = await runConnector(connector, { fetchText: unusedFetch });

      expect(run!.status).toBe("succeeded");
      expect(run!.discovered).toBeGreaterThan(0);
      expect(run!.inserted).toBeGreaterThan(0);
      expect(countersSumToDiscovered(run!)).toBe(true);
      expect(await AppDataSource.getRepository(Article).count()).toBe(run!.inserted);
    }, 120_000);
  });
});

// #47. ADR-0018's fourth surface: the body of a page a feed only teased. Driven
// against two committed real captures — an NPR article the committed NPR feed
// links to, and a Cloudflare interstitial, which is what a bot-blocked publisher
// actually serves — so both outcomes are the ones the open web produces.
describe("runConnector over Readability extraction", () => {
  const nprUrl = "https://www.npr.org/2026/08/30/nx-s1-5949254/lake-ontario-america-doug-ford-trump-sign-google";
  const nprFeed = fixture("npr-world.xml");
  const page = (name: string) => readFile(join(__dirname, "fixtures", "readability", name), "utf-8");
  // Extraction reads Articles, not a source — so a fetcher it reaches for at all
  // is a bug, and each test below proves it by passing one that refuses.
  const noFeed: FetchText = () => Promise.reject(new Error("extraction must not fetch a feed"));

  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  async function createExtractionConnector(): Promise<IngestionConnector> {
    nextConnector += 1;
    return AppDataSource.getRepository(IngestionConnector).save({
      name: `Test extraction ${nextConnector}`,
      kind: "readability",
      endpoint: "internal:readability",
      enabled: true,
    });
  }

  it("replaces a feed teaser with the page's real body, and counts the pages that refuse", async () => {
    const rss = await createRssConnector("https://feeds.npr.org/1004/rss.xml");
    expect((await runConnector(rss, { fetchText: nprFeed }))!.inserted).toBe(3);
    const articles = AppDataSource.getRepository(Article);
    const before = await articles.findOneByOrFail({ url: nprUrl });
    expect(before.analysisTextMode).toBe("feed_excerpt");

    const connector = await createExtractionConnector();
    const run = await runConnector(connector, {
      fetchText: noFeed,
      // One real article page; the other two candidates get the interstitial, which
      // is the majority outcome ADR-0018 predicts.
      fetchPage: (url) => page(url === nprUrl ? "npr-lake-ontario.html" : "bot-challenge.html"),
    });

    expect(run!.status).toBe("succeeded");
    // Every candidate attempted is one discovered item with one outcome, so an
    // extraction run's ledger reads like any other connector's.
    expect(run!.discovered).toBe(3);
    expect(run!.enriched).toBe(1);
    expect(run!.failed).toBe(2);
    expect(run!.inserted).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // Extraction keeps its place per Article, not as a position in a stream.
    expect(run!.cursor).toBeNull();
    expect(run!.errorSummary).toMatch(/no readable body/);

    const after = await articles.findOneByOrFail({ id: before.id });
    expect(after.analysisTextMode).toBe("api_content");
    expect(after.analysisText!.length).toBeGreaterThan(10 * before.analysisText!.length);
    // A sentence that exists only in the page, never in the feed item.
    expect(after.analysisText).toContain("the rest of the world will always call it Lake Ontario");
    // The extraction made no second Article and disturbed nothing else about this
    // one — it is still the Unclustered Article the feed inserted.
    expect(await articles.count()).toBe(3);
    expect(after.storyId).toBeNull();
    expect(after.url).toBe(before.url);
    expect(after.title).toBe(before.title);

    // A page that refused leaves its Article exactly where it was: a paywall is an
    // expected outcome, not a lost row and not a downgrade.
    const refused = await articles.findBy({ analysisTextMode: "feed_excerpt" });
    expect(refused).toHaveLength(2);
    expect(refused.every((article) => article.analysisText !== null)).toBe(true);
  });

  it("stores the extracted body for analysis and serves it to nobody", async () => {
    const rss = await createRssConnector("https://feeds.npr.org/1004/rss.xml");
    await runConnector(rss, { fetchText: nprFeed });
    const connector = await createExtractionConnector();
    await runConnector(connector, { fetchText: noFeed, fetchPage: () => page("npr-lake-ontario.html") });
    const extracted = await AppDataSource.getRepository(Article).findOneByOrFail({ url: nprUrl });
    expect(extracted.analysisTextMode).toBe("api_content");

    // The strongest form of the rule: even hand-classified as `licensed`, a body
    // Tessera extracted itself is not the publisher's to grant (CONTEXT.md "Terms
    // Class"), so no Terms Class clears it.
    await AppDataSource.getRepository(Publisher).update({ id: extracted.publisherId }, { termsClass: "licensed" });
    expect(mayServeText("licensed", "api_content")).toBe(false);

    // And today it is not reachable at all: ingestion leaves the Article
    // unclustered, and every public read path joins through Story.
    const token = await registerAndLogin("extraction-reader@example.com", "student");
    const res = await request(app())
      .get(`/api/v1/articles/${extracted.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("caps attempts per run and never re-fetches a page it already tried", async () => {
    const rss = await createRssConnector("https://example.test/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Example",
      domain: "example.test",
    });
    const backlog = MAX_EXTRACTION_ATTEMPTS + 5;
    await AppDataSource.getRepository(Article).insert(
      Array.from({ length: backlog }, (_, index) => ({
        publisherId: publisher.id,
        discoveredByConnectorId: rss.id,
        storyId: null,
        title: `Teased story ${index}`,
        url: `https://example.test/story-${index}`,
        analysisText: "A one-line teaser.",
        analysisTextMode: "feed_excerpt" as const,
        publishedAt: new Date(),
      })),
    );

    const connector = await createExtractionConnector();
    const fetched: string[] = [];
    const deps: RunConnectorDeps = {
      fetchText: noFeed,
      fetchPage: (url) => {
        fetched.push(url);
        return Promise.reject(new Error("responded 403"));
      },
    };

    const first = await runConnector(connector, deps);
    expect(first!.status).toBe("succeeded");
    expect(first!.discovered).toBe(MAX_EXTRACTION_ATTEMPTS);
    expect(first!.failed).toBe(MAX_EXTRACTION_ATTEMPTS);
    expect(countersSumToDiscovered(first!)).toBe(true);
    // The reason is on the run, so an operator diagnoses a blocked publisher
    // without reading server logs.
    expect(first!.errorSummary).toMatch(/extraction failed for https:\/\/example\.test\/story-\d+: responded 403/);
    // #46's convention: a run that read its cap's worth has not cleared the
    // backlog, and `discovered` alone cannot say so.
    expect(first!.errorSummary).toMatch(new RegExp(`hit the ${MAX_EXTRACTION_ATTEMPTS}-page cap`));

    // The backlog drains rather than being re-walked: a failure leaves the mode
    // alone, so only the attempt mark stops the next run starting where this one
    // did.
    const second = await runConnector(connector, deps);
    expect(second!.discovered).toBe(backlog - MAX_EXTRACTION_ATTEMPTS);
    const third = await runConnector(connector, deps);
    expect(third!.discovered).toBe(0);
    expect(fetched).toHaveLength(backlog);
    expect(new Set(fetched).size).toBe(backlog);
    // Every one of them still holds the excerpt it arrived with.
    expect(await AppDataSource.getRepository(Article).countBy({ analysisTextMode: "feed_excerpt" })).toBe(backlog);
  });

  it("never fetches a page for a GKG-discovered Article, even one a feed later enriched", async () => {
    const gkg = await createGkgConnector();
    const rss = await createRssConnector("https://wmuk.example/feed.xml");
    await runConnector(gkg, gkgFixture("20260830190000.gkg.csv"));
    // The same canonical URL from a feed, which raises that GKG row to
    // `feed_excerpt` — the one way a firehose row can look like a candidate.
    await runConnector(rss, { fetchText: fixture("wmuk-npr-news.xml") });
    expect(
      await AppDataSource.getRepository(Article).countBy({ analysisTextMode: "feed_excerpt" }),
    ).toBe(1);

    const connector = await createExtractionConnector();
    const run = await runConnector(connector, {
      fetchText: noFeed,
      // 63k firehose rows a day across 163+ unknown domains is the crawler #47
      // exists not to be, so a single fetch here is a failure of the ticket.
      fetchPage: () => Promise.reject(new Error("extraction must not fetch a GKG-discovered page")),
    });

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(0);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
  });

  it("leaves alone the Articles whose page it has no business reading", async () => {
    const rss = await createRssConnector("https://example.test/feed.xml");
    const fullTextRss = await createRssConnector("https://example.test/full-feed.xml", true, true);
    const publishers = AppDataSource.getRepository(Publisher);
    const [internal, syndicated, open] = await Promise.all([
      publishers.save({ name: "Internal", domain: "internal.test", termsClass: "internal_only" as const }),
      publishers.save({ name: "Syndicated", domain: "syndicated.test", termsClass: "syndicated_excerpt" as const }),
      publishers.save({ name: "Open", domain: "open.test", termsClass: "open_metadata" as const }),
    ]);
    const teaser = "A one-line teaser.";
    await AppDataSource.getRepository(Article).insert([
      // A feed that supplied the whole article: nothing to fetch, and fetching it
      // would risk replacing that body with a shorter extraction.
      {
        publisherId: internal.id,
        discoveredByConnectorId: fullTextRss.id,
        title: "Feed carried the body",
        url: "https://internal.test/full",
        analysisText: "Real reporting. ".repeat(200),
        analysisTextMode: "feed_excerpt" as const,
        publishedAt: new Date(),
      },
      // #40 cleared this publisher's excerpt for serving, and no Terms Class clears
      // an extracted body — so extracting would take text out of the API.
      {
        publisherId: syndicated.id,
        discoveredByConnectorId: rss.id,
        title: "Excerpt already cleared",
        url: "https://syndicated.test/teased",
        analysisText: teaser,
        analysisTextMode: "feed_excerpt" as const,
        publishedAt: new Date(),
      },
      // An open_metadata publisher's text is not Tessera's to hold at all.
      {
        publisherId: open.id,
        discoveredByConnectorId: rss.id,
        title: "Metadata only rights",
        url: "https://open.test/teased",
        analysisText: teaser,
        analysisTextMode: "feed_excerpt" as const,
        publishedAt: new Date(),
      },
    ]);

    const connector = await createExtractionConnector();
    const run = await runConnector(connector, {
      fetchText: noFeed,
      fetchPage: (url) => Promise.reject(new Error(`extraction must not fetch ${url}`)),
    });

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    // None of them was even marked as attempted: they are not candidates, as
    // against candidates that failed.
    expect(await AppDataSource.getRepository(Article).countBy({ extractionAttemptedAt: IsNull() })).toBe(3);
  });

  it("declines a body no longer than the excerpt it would replace", async () => {
    const rss = await createRssConnector("https://example.test/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Example",
      domain: "example.test",
    });
    // A long teaser: still a teaser by the candidate rule, but longer than what the
    // page below yields.
    const excerpt = "The feed said this much and no more. ".repeat(30);
    await AppDataSource.getRepository(Article).insert({
      publisherId: publisher.id,
      discoveredByConnectorId: rss.id,
      title: "Teased at length",
      url: "https://example.test/teased",
      analysisText: excerpt,
      analysisTextMode: "feed_excerpt" as const,
      publishedAt: new Date(),
    });

    const connector = await createExtractionConnector();
    const run = await runConnector(connector, {
      fetchText: noFeed,
      // Over the floor a consent wall has to clear, under what the feed already
      // gave us — a page whose article body is mostly the standfirst.
      fetchPage: async () => `<html><body><article><p>${"Only this much of it. ".repeat(32)}</p></article></body></html>`,
    });

    expect(run!.discovered).toBe(1);
    expect(run!.failed).toBe(1);
    expect(run!.enriched).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.errorSummary).toMatch(/body no longer than the excerpt held/);
    // ADR-0024's ladder is one-way, so declining is the only way not to lose the
    // longer text permanently.
    const after = await AppDataSource.getRepository(Article).findOneByOrFail({ url: "https://example.test/teased" });
    expect(after.analysisTextMode).toBe("feed_excerpt");
    expect(after.analysisText).toBe(excerpt);
  });

  it("uses RSS feed policy rather than text length to choose extraction candidates", async () => {
    const teaserFeed = await createRssConnector("https://feeds.example.test/teasers.xml");
    const fullTextFeed = await createRssConnector("https://feeds.example.test/full.xml", true, true);
    const feed = (title: string, path: string, text: string) => `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Example News</title><item>
        <title>${title}</title>
        <link>https://example.test/${path}</link>
        <pubDate>Sun, 30 Aug 2026 12:00:00 GMT</pubDate>
        <description>${text}</description>
      </item></channel></rss>`;

    await runConnector(teaserFeed, { fetchText: async () => feed("Long teaser", "long-teaser", "Teaser. ".repeat(300)) });
    await runConnector(fullTextFeed, { fetchText: async () => feed("Short complete", "short-complete", "Complete.") });

    const fetched: string[] = [];
    const connector = await createExtractionConnector();
    const run = await runConnector(connector, {
      fetchText: noFeed,
      fetchPage: (url) => {
        fetched.push(url);
        return Promise.reject(new Error("responded 403"));
      },
    });

    expect(run!.discovered).toBe(1);
    expect(fetched).toEqual(["https://example.test/long-teaser"]);
  });

  it("refuses private page addresses before fetching, including redirect destinations", async () => {
    const { httpFetchPage } = await import("../src/ingestion/runConnector");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(httpFetchPage("http://127.0.0.1/private")).rejects.toThrow(/public/);
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
      );
      await expect(httpFetchPage("http://93.184.216.34/start")).rejects.toThrow(/public/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses non-global IPv6 page addresses", async () => {
    const { httpFetchPage } = await import("../src/ingestion/runConnector");
    for (const address of ["fec0::1", "100:0:0:1::1", "2001:2::1"]) {
      const resolve = vi.fn(async () => [{ address, family: 6 }]) as unknown as typeof import("node:dns/promises").lookup;
      await expect(
        httpFetchPage("http://ipv6.example/story", {
          resolve,
          createDispatcher: () => {
            throw new Error("a non-global address must not reach the dispatcher");
          },
        }),
      ).rejects.toThrow(/public/);
    }
  });

  it("pins the vetted DNS answer so a rebinding lookup cannot change the connection", async () => {
    const { httpFetchPage } = await import("../src/ingestion/runConnector");
    const { Agent } = await import("undici");
    const resolve = vi.fn(async () => [{ address: "93.184.216.36", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup;
    const createDispatcher = vi.fn(
      (address: string, family: 4 | 6) =>
        new Agent({ connect: { lookup: (_hostname, _options, callback) => callback(null, address, family) } }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><body>safe</body></html>", { headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(httpFetchPage("http://rebind.example/story", { resolve, createDispatcher })).resolves.toContain(
        "safe",
      );
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(createDispatcher).toHaveBeenCalledWith("93.184.216.36", 4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an oversized chunked page while consuming its body", async () => {
    const { httpFetchPage } = await import("../src/ingestion/runConnector");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(httpFetchPage("http://93.184.216.37/chunked")).rejects.toThrow(/exceeded 4194304 bytes/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("paces every redirect hop on the destination publisher domain", async () => {
    const { httpFetchPage } = await import("../src/ingestion/runConnector");
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://93.184.216.35/final" } }),
      )
      .mockResolvedValueOnce(
        new Response("<html><body>done</body></html>", { headers: { "content-type": "text/html" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const page = httpFetchPage("http://93.184.216.35/start");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(EXTRACTION_MIN_DOMAIN_INTERVAL_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(page).resolves.toContain("done");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("spaces requests to one publisher without holding up another", async () => {
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(EXTRACTION_MIN_DOMAIN_INTERVAL_MS);
      await spaceExtractionRequest("https://a.example/one");

      let sameHost = false;
      let otherHost = false;
      const queued = spaceExtractionRequest("https://a.example/two").then(() => void (sameHost = true));
      await spaceExtractionRequest("https://b.example/one").then(() => void (otherHost = true));

      // A second host is not made to wait for the first one's interval.
      expect(otherHost).toBe(true);
      await vi.advanceTimersByTimeAsync(EXTRACTION_MIN_DOMAIN_INTERVAL_MS - 1);
      expect(sameHost).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await queued;
      expect(sameHost).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #45. The firehose is unbounded, so what it leaves behind ages out on a rolling
// window and disk use has a ceiling. Narrow by design: only rows a GDELT connector
// discovered that nothing has since enriched with text.
describe("GDELT retention", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // A minute either side of the boundary, so the assertion is about the boundary
  // and not about how long the test took to run.
  const MINUTE = 60 * 1000;
  const expired = () => new Date(daysAgo(GDELT_RETENTION_DAYS).getTime() - MINUTE);
  const inside = () => new Date(daysAgo(GDELT_RETENTION_DAYS).getTime() + MINUTE);

  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  // `storedAt` is the axis retention reads, and TypeORM writes @CreateDateColumn
  // itself on insert — so it is backdated afterwards rather than passed in.
  async function stored(
    connector: IngestionConnector | null,
    storedAt: Date,
    mode: AnalysisTextMode = "metadata_only",
  ): Promise<Article> {
    const publishers = AppDataSource.getRepository(Publisher);
    const publisher =
      (await publishers.findOneBy({ domain: "retention.example" })) ??
      (await publishers.save({ name: "Retention Example", domain: "retention.example" }));
    const article = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: connector?.id ?? null,
      title: `Reporting ${randomUUID()}`,
      url: `https://retention.example/${randomUUID()}`,
      analysisText: mode === "metadata_only" ? null : "The excerpt a feed carried.",
      analysisTextMode: mode,
      tone: null,
      publishedAt: storedAt,
    });
    await AppDataSource.query(`UPDATE articles SET "createdAt" = $1 WHERE id = $2`, [storedAt, article.id]);
    return article;
  }

  const heldIds = async () =>
    (await AppDataSource.getRepository(Article).find({ select: { id: true } })).map((article) => article.id);

  it("removes GKG rows past the seven-day boundary and keeps the ones inside it", async () => {
    const connector = await createGkgConnector();
    const aged = await stored(connector, expired());
    const fresh = await stored(connector, inside());
    // The bulk of the bytes are the occurrences, which go with the Article
    // (ON DELETE CASCADE) rather than being left orphaned.
    await AppDataSource.getRepository(GkgAnnotation).save({
      articleId: aged.id,
      kind: "person" as const,
      surfaceName: "Mark Carney",
      charOffset: 12,
      locationDetail: null,
    });

    expect(await pruneExpiredGdeltArticles()).toBe(1);

    expect(await heldIds()).toEqual([fresh.id]);
    expect(await AppDataSource.getRepository(GkgAnnotation).countBy({ articleId: aged.id })).toBe(0);
  });

  // #46: the DOC API produces the same text-free metadata rows the firehose does —
  // up to 250 per run, on the same 15-minute tick — so it ages out on the same
  // terms. Without this the connector added in #46 would be an unbounded producer
  // with no expiry at all.
  it("removes expired DOC rows on the same terms as firehose rows", async () => {
    const connector = await createDocConnector();
    await stored(connector, expired());
    const fresh = await stored(connector, inside());

    expect(await pruneExpiredGdeltArticles()).toBe(1);

    expect(await heldIds()).toEqual([fresh.id]);
  });

  // The horizon is when the row was stored, not what it reports on: GDELT carries
  // documents whose own timestamp is old, and pruning on that would insert them,
  // delete them, and insert them again from the next window that mentions them.
  it("keeps a freshly stored row that reports on something older than the horizon", async () => {
    const connector = await createGkgConnector();
    const old = await stored(connector, inside());
    await AppDataSource.getRepository(Article).update({ id: old.id }, { publishedAt: daysAgo(400) });

    expect(await pruneExpiredGdeltArticles()).toBe(0);

    expect(await heldIds()).toEqual([old.id]);
  });

  it("never removes RSS-discovered reporting, enriched text, or the curated corpus", async () => {
    const gkg = await createGkgConnector();
    const rss = await createRssConnector("https://retention.example/feed.xml");
    // All three are well past the horizon; none of them is firehose metadata.
    const feedDiscovered = await stored(rss, daysAgo(90), "feed_excerpt");
    // A GKG row an RSS feed later gave an excerpt to keeps the GKG connector as
    // its discoverer, so the ladder rung is what has to save it.
    const enriched = await stored(gkg, daysAgo(90), "feed_excerpt");
    // Seeded fixtures were discovered by nothing at all (ADR-0007).
    const seeded = await stored(null, daysAgo(90), "manual_fixture");

    expect(await pruneExpiredGdeltArticles()).toBe(0);

    expect((await heldIds()).sort()).toEqual([feedDiscovered.id, enriched.id, seeded.id].sort());
  });

  it("declines to delete a GKG row a Story or a Brief has taken hold of", async () => {
    const connector = await createGkgConnector();
    const clustered = await stored(connector, expired());
    const cited = await stored(connector, expired());
    const story = await AppDataSource.getRepository(Story).save({
      slug: `retention-story-${randomUUID()}`,
      title: "A Story Phase 3 clustered",
      summary: "Nothing clusters metadata_only rows yet; retention runs unattended anyway.",
      category: "technology",
      firstSeenAt: expired(),
      lastSeenAt: expired(),
    });
    await AppDataSource.getRepository(Article)
      .update({ id: clustered.id }, { storyId: story.id, storyAssignmentStatus: "auto_accepted" });
    const owner = await AppDataSource.getRepository(User).save({
      email: `retention-owner-${randomUUID()}@example.com`,
      passwordHash: await bcrypt.hash("correct-horse", 10),
      role: "investor" as const,
    });
    const brief = await AppDataSource.getRepository(IntelligenceBrief).save({
      ownerId: owner.id,
      title: "A Brief citing a firehose row",
      category: "technology" as const,
      body: "Both references cascade, so retention has to refuse rather than rely on the FK.",
    });
    await AppDataSource.query(`INSERT INTO brief_articles ("briefId", "articleId") VALUES ($1, $2)`, [
      brief.id,
      cited.id,
    ]);

    expect(await pruneExpiredGdeltArticles()).toBe(0);

    expect((await heldIds()).sort()).toEqual([clustered.id, cited.id].sort());
  });

  it("ages rows out on the 15-minute tick, alongside enqueueing the fleet", async () => {
    const connector = await createGkgConnector();
    await stored(connector, expired());

    await runIngestionJob({ name: TICK_JOB, data: {} });

    expect(await AppDataSource.getRepository(Article).count()).toBe(0);
  });
});

describe("a completed run does not disturb the curated corpus", () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndLogin("ingestion-reader@example.com", "student");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Curated Press",
      domain: "curated-press.example",
    });
    const story = await AppDataSource.getRepository(Story).save({
      slug: "curated-corpus-story",
      title: "Packaging capacity expands",
      summary: "A curated fixture Story.",
      category: "technology",
      firstSeenAt: new Date("2026-02-01T00:00:00Z"),
      lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    });
    await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      storyAssignmentStatus: "auto_accepted" as const,
      publisherId: publisher.id,
      title: "Fab announces new packaging line",
      url: "https://curated-press.example/packaging-line",
      analysisText: "A new advanced packaging line.",
      analysisTextMode: "manual_fixture",
      publishedAt: new Date("2026-02-01T00:00:00Z"),
    });
  });

  it("leaves Story browse and search results identical, for GKG rows too", async () => {
    const stories = () => request(app()).get("/api/v1/stories").set("Authorization", `Bearer ${token}`);
    const search = () =>
      request(app()).get("/api/v1/search?q=packaging").set("Authorization", `Bearer ${token}`);

    const storiesBefore = await stories();
    const searchBefore = await search();
    expect(searchBefore.body.total).toBeGreaterThan(0);

    const connector = await createRssConnector("https://undisturbed.example/feed.xml");
    const run = await runConnector(connector, { fetchText: fixture("npr-world.xml") });
    expect(run!.inserted).toBeGreaterThan(0);
    const gkgConnector = await createGkgConnector();
    const gkgRun = await runConnector(gkgConnector, gkgFixture("20260830190000.gkg.csv"));
    expect(gkgRun!.status).toBe("succeeded");
    // Inserted here or already held from an earlier run in this file — either way
    // the metadata_only rows are in the table while these assertions run.
    expect(await AppDataSource.getRepository(Article).countBy({ analysisTextMode: "metadata_only" })).toBeGreaterThan(0);

    expect((await stories()).body).toEqual(storiesBefore.body);
    expect((await search()).body).toEqual(searchBefore.body);
    // A term that appears *only* in a GKG-discovered title: it is in the
    // Article's own searchVector and still unreachable, because every read path
    // joins through Story and a GKG row has none.
    const gkgTerm = await request(app())
      .get("/api/v1/search?q=Manipur")
      .set("Authorization", `Bearer ${token}`);
    expect(gkgTerm.body.total).toBe(0);
  });

  it("404s an Unclustered Article requested by id rather than 500ing on its absent Story", async () => {
    const connector = await createRssConnector("https://unclustered.example/feed.xml");
    await runConnector(connector, { fetchText: fixture("bbc-world.xml") });
    const article = await AppDataSource.getRepository(Article).findOneByOrFail({
      discoveredByConnectorId: connector.id,
    });

    const res = await request(app())
      .get(`/api/v1/articles/${article.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// Seam 2: only what is HTTP-visible. The endpoint's RBAC, that it enqueues onto
// the queue the worker drains (#42), and that the Admin dashboard carries the
// history — read from Postgres, so it is there with the worker stopped.
describe("the Admin ingestion surface", () => {
  // A closed local port, so a run that does happen reaches runConnector and
  // persists a row without any external network.
  const CLOSED_PORT_FEED = "http://127.0.0.1:1/feed.xml";

  beforeEach(() => {
    enqueued.length = 0;
  });

  it("is Admin-only", async () => {
    const connector = await createRssConnector(CLOSED_PORT_FEED);
    const path = `/api/v1/ingestion/connectors/${connector.id}/run`;

    expect((await request(app()).post(path)).status).toBe(401);

    const student = await registerAndLogin("ingestion-student@example.com", "student");
    expect((await request(app()).post(path).set("Authorization", `Bearer ${student}`)).status).toBe(403);

    const investor = await registerAndLogin("ingestion-investor@example.com", "investor");
    expect((await request(app()).post(path).set("Authorization", `Bearer ${investor}`)).status).toBe(403);

    // None of the three refusals reached the queue.
    expect(enqueued).toEqual([]);
  });

  it("accepts the command by enqueueing it, and runs nothing in the request", async () => {
    const token = await createAdminToken("ingestion-admin@example.com");
    const connector = await createRssConnector(CLOSED_PORT_FEED);

    const res = await request(app())
      .post(`/api/v1/ingestion/connectors/${connector.id}/run`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ connectorId: connector.id, status: "accepted" });
    expect(enqueued).toEqual([connector.id]);
    // The worker records the run; the request does not. An IngestionRun row here
    // would mean the endpoint still executed inline.
    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id })).toBe(0);
  });

  it("refuses to run a disabled connector, and 404s an unknown one", async () => {
    const token = await createAdminToken("ingestion-admin-disabled@example.com");
    const disabled = await createRssConnector(CLOSED_PORT_FEED, false);

    const refused = await request(app())
      .post(`/api/v1/ingestion/connectors/${disabled.id}/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(refused.status).toBe(422);

    const missing = await request(app())
      .post(`/api/v1/ingestion/connectors/00000000-0000-0000-0000-000000000000/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);

    expect(enqueued).toEqual([]);
  });

  it("lets an Admin disable a connector without a deploy, and nobody else", async () => {
    const token = await createAdminToken("ingestion-admin-toggle@example.com");
    const connector = await createRssConnector(CLOSED_PORT_FEED);

    const disabled = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect((await AppDataSource.getRepository(IngestionConnector).findOneByOrFail({ id: connector.id })).enabled).toBe(
      false,
    );

    const student = await registerAndLogin("ingestion-toggle-student@example.com", "student");
    const forbidden = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${student}`)
      .send({ enabled: true });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: "yes" });
    expect(invalid.status).toBe(422);
  });

  it("carries IngestionRun history on the Admin dashboard payload, newest first", async () => {
    const token = await createAdminToken("ingestion-admin-history@example.com");
    const connector = await createRssConnector("https://history.example/feed.xml");
    const older = await runConnector(connector, { fetchText: failingFetch });
    const newer = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    const res = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const runs = res.body.ingestionRuns as {
      id: string;
      connectorName: string;
      status: string;
      errorSummary: string | null;
    }[];
    const ours = runs.filter((run) => run.connectorName === connector.name);
    expect(ours.map((run) => run.id)).toEqual([newer!.id, older!.id]);
    expect(ours[0]).toMatchObject({ status: "succeeded", discovered: 3 });
    expect(ours[1]).toMatchObject({ status: "failed" });
    expect(ours[1].errorSummary).toContain("ENOTFOUND");
  });
});


// #42: the worker's side of the same queue. Driven as a function rather than
// through a live bullmq Worker, because Redis is not in the test stack — what is
// worth proving is the fan-out's rule and that a run job reaches the same run
// function the Admin trigger does.
describe("the ingestion worker's job handler", () => {
  const CLOSED_PORT_FEED = "http://127.0.0.1:1/feed.xml";

  beforeEach(() => {
    enqueued.length = 0;
  });

  it("fans the 15-minute tick out to the enabled connectors and no others", async () => {
    const live = await createRssConnector(CLOSED_PORT_FEED);
    const paused = await createRssConnector(CLOSED_PORT_FEED, false);

    await runIngestionJob({ name: TICK_JOB, data: {} });

    expect(enqueued).toContain(live.id);
    expect(enqueued).not.toContain(paused.id);
    // A tick enqueues; it must not run anything itself, or the fleet would run
    // inside one job and the per-connector job id would stop deduplicating.
    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: live.id })).toBe(0);
  });

  it("executes a run job through the same run function, and records the run", async () => {
    const connector = await createRssConnector(CLOSED_PORT_FEED);

    await runIngestionJob({ name: RUN_JOB, data: { connectorId: connector.id } });

    const run = await AppDataSource.getRepository(IngestionRun).findOneByOrFail({ connectorId: connector.id });
    // The feed is a closed port, so the run fails — the point is that it is a
    // persisted IngestionRun with a legible reason and not a thrown job.
    expect(run.status).toBe("failed");
    expect(run.errorSummary).not.toBeNull();
  });

  it("records nothing for a connector disabled after its job was enqueued", async () => {
    const connector = await createRssConnector(CLOSED_PORT_FEED);
    await AppDataSource.getRepository(IngestionConnector).update({ id: connector.id }, { enabled: false });

    await runIngestionJob({ name: RUN_JOB, data: { connectorId: connector.id } });

    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id })).toBe(0);
  });

  it("ignores a run job for a connector that no longer exists", async () => {
    await expect(
      runIngestionJob({ name: RUN_JOB, data: { connectorId: "00000000-0000-0000-0000-000000000000" } }),
    ).resolves.toBeUndefined();
  });
});
