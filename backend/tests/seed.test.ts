import { describe, expect, it, beforeAll } from "vitest";
import { AppDataSource } from "../src/data-source";
import { IntelligenceBrief } from "../src/entities/IntelligenceBrief";
import { User, USER_ROLES } from "../src/entities/User";
import { Story } from "../src/entities/Story";
import { BriefArticle } from "../src/entities/BriefArticle";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { LocalDiskFileStorageProvider } from "../src/storage/LocalDiskFileStorageProvider";
import { SEED_CONNECTORS } from "../src/seedData/corpus";
import { seedAll } from "../src/seed";

const SEED_BRIEF_TITLE = "AI Accelerator Supply Chain Watch";
import { setupTestDb } from "./setupTestDb";

// #23's exit criterion is a documented path from a fresh clone to a *populated*
// demo. That claim is only as good as the seed, so this runs the real thing
// against a real (ephemeral) database rather than asserting on fixtures.
describe("npm run seed", () => {
  setupTestDb();

  beforeAll(async () => {
    await seedAll();
  });

  it("creates a login for all three roles", async () => {
    const users = await AppDataSource.getRepository(User).find();
    expect(users.map((u) => u.role).sort()).toEqual([...USER_ROLES].sort());
  });

  it("populates the browsable corpus with multi-source Stories", async () => {
    const stories = await AppDataSource.getRepository(Story).find({ relations: { articles: true } });
    expect(stories.length).toBeGreaterThan(0);
    // "Multi-source" is the point of the corpus: a Story carrying one Article
    // can't demo the cross-publisher comparison the browse pages are built for.
    expect(stories.some((story) => story.articles.length > 1)).toBe(true);
  });

  it("embeds every seeded Article so hybrid search has a semantic half", async () => {
    const [{ count }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM articles WHERE embedding IS NULL`,
    );
    expect(count).toBe(0);
  });

  // ADR-0024's near-miss, guarded against regression: making `analysisText`
  // nullable forced `articles.searchVector` to coalesce it, and a coalesce is
  // exactly the kind of rewrite that quietly changes what the demo corpus
  // matches. `coalesce(x, '')` must be a no-op for every row that *has* text, so
  // the stored vector is compared against the pre-migration expression itself —
  // identical tsvectors mean identical ts_rank, and therefore identical search
  // results for the seeded corpus.
  it("leaves the seeded corpus's search vectors identical to the pre-coalesce expression", async () => {
    const [{ compared, differing }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS compared,
              COUNT(*) FILTER (
                WHERE "searchVector" IS DISTINCT FROM (
                  setweight(to_tsvector('english', "title"), 'A') ||
                  setweight(to_tsvector('english', "analysisText"), 'B')
                )
              )::int AS differing
       FROM articles WHERE "analysisText" IS NOT NULL`,
    );
    expect(compared).toBeGreaterThan(0);
    expect(differing).toBe(0);
  });

  it("seeds the IngestionConnectors the Admin dashboard inspects", async () => {
    const connectors = await AppDataSource.getRepository(IngestionConnector).find();
    expect(connectors.length).toBeGreaterThan(0);
    expect(connectors.map((c) => c.kind)).toContain("gdelt_gkg");
    // #41 built the GKG connector and #46 the DOC one, so both are enabled and an
    // Admin's Run button on either row does something.
    expect(connectors.find((connector) => connector.kind === "gdelt_gkg")!.enabled).toBe(true);
    const doc = connectors.find((connector) => connector.kind === "gdelt_doc")!;
    expect(doc.enabled).toBe(true);
    // #46: DOC answers a question, so the question is the connector — a DOC
    // endpoint with no query is one no run can succeed against.
    expect(new URL(doc.endpoint).searchParams.get("query")).toBeTruthy();

    // #39: the curated RSS list is what ingestion actually runs, so it has to be
    // real feeds — the placeholder it replaced pointed at a domain that cannot
    // resolve, which made the only RSS connector unrunnable.
    const rss = connectors.filter((connector) => connector.kind === "rss");
    expect(rss.length).toBeGreaterThanOrEqual(8);
    expect(rss.length).toBeLessThanOrEqual(12);
    expect(rss.every((connector) => connector.enabled)).toBe(true);
    expect(rss.every((connector) => /^https:\/\//.test(connector.endpoint))).toBe(true);
    expect(rss.some((connector) => connector.endpoint.includes(".example"))).toBe(false);

    // #47: the fourth surface, enabled, so the worker's tick picks up the backlog
    // the feeds above leave behind. It fetches nothing at its endpoint — it reads
    // Articles — so the endpoint is a scheme no fetcher recognises rather than an
    // address someone might trust.
    const extraction = connectors.filter((connector) => connector.kind === "readability");
    expect(extraction).toHaveLength(1);
    expect(extraction[0].enabled).toBe(true);
    expect(extraction[0].endpoint).toBe("internal:readability");
  });

  it("creates one owned Brief complete on every mandated field, media included", async () => {
    const brief = await AppDataSource.getRepository(IntelligenceBrief).findOneOrFail({
      where: { title: SEED_BRIEF_TITLE },
      relations: { owner: true },
    });

    expect(brief.owner.email).toBe("student@tessera.local");
    expect(brief.note).toBeTruthy();
    expect(brief.category).toBe("technology");
    expect(brief.articleCapacityLimit).toBeGreaterThan(0);
    expect(brief.coverImageKey).toMatch(/\.png$/);

    // The key has to resolve to real bytes: a coverImageKey with nothing behind
    // it 404s on GET /briefs/:id/cover-image, which is worse than a null one.
    const stored = await new LocalDiskFileStorageProvider().read(brief.coverImageKey!);
    expect(stored?.subarray(1, 4).toString()).toBe("PNG");

    const attached = await AppDataSource.getRepository(BriefArticle).countBy({ briefId: brief.id });
    expect(attached).toBeGreaterThan(0);
    expect(attached).toBeLessThanOrEqual(brief.articleCapacityLimit);
  });

  it("is idempotent — a re-run after a migration must not duplicate or throw", async () => {
    const repo = AppDataSource.getRepository(IntelligenceBrief);
    const before = await repo.findOneOrFail({ where: { title: SEED_BRIEF_TITLE } });

    await expect(seedAll()).resolves.not.toThrow();

    expect(await repo.count()).toBe(1);
    expect(await AppDataSource.getRepository(User).count()).toBe(USER_ROLES.length);
    expect(await AppDataSource.getRepository(IngestionConnector).count()).toBe(SEED_CONNECTORS.length);
    // A second cover image would orphan the first file on disk and churn the key
    // the frontend just cached, so the backfill must not fire on a Brief that
    // already has one.
    const after = await repo.findOneOrFail({ where: { title: SEED_BRIEF_TITLE } });
    expect(after.coverImageKey).toBe(before.coverImageKey);
  });

  it("backfills a missing cover image on a Brief seeded before the media field existed", async () => {
    const repo = AppDataSource.getRepository(IntelligenceBrief);
    const brief = await repo.findOneOrFail({ where: { title: SEED_BRIEF_TITLE } });
    await repo.update({ id: brief.id }, { coverImageKey: null });

    await seedAll();

    const backfilled = await repo.findOneOrFail({ where: { title: SEED_BRIEF_TITLE } });
    expect(backfilled.coverImageKey).toMatch(/\.png$/);
  });

  // #46: a database seeded before the DOC connector had a query would hold an
  // endpoint no run can succeed against, and there is no API for editing one.
  // `enabled` deliberately does not converge — an Admin who turned a connector off
  // must not have a re-seed turn it back on.
  it("converges a stale connector endpoint without overriding an Admin's enabled flag", async () => {
    const repo = AppDataSource.getRepository(IngestionConnector);
    const seeded = SEED_CONNECTORS.find((connector) => connector.kind === "gdelt_doc")!;
    // Restored either way: a failure here must not leave the connector disabled for
    // whatever test runs next.
    try {
      await repo.update(
        { name: seeded.name },
        { endpoint: "https://api.gdeltproject.org/api/v2/doc/doc", enabled: false },
      );

      await seedAll();

      const converged = await repo.findOneByOrFail({ name: seeded.name });
      expect(converged.endpoint).toBe(seeded.endpoint);
      expect(converged.enabled).toBe(false);
    } finally {
      await repo.update({ name: seeded.name }, { enabled: seeded.enabled });
    }
  });
});
