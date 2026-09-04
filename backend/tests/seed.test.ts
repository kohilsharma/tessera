import { describe, expect, it, beforeAll } from "vitest";
import { AppDataSource } from "../src/data-source";
import { IntelligenceBrief } from "../src/entities/IntelligenceBrief";
import { User, USER_ROLES } from "../src/entities/User";
import { Story } from "../src/entities/Story";
import { Publisher } from "../src/entities/Publisher";
import { BriefArticle } from "../src/entities/BriefArticle";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { GkgAnnotation } from "../src/entities/GkgAnnotation";
import { Article } from "../src/entities/Article";
import { pruneExpiredGdeltArticles } from "../src/ingestion/retention";
import { DEFAULT_PROMPT_PARAMS, PromptTemplate } from "../src/entities/PromptTemplate";
import { PROMPT_VERSION } from "../src/generation/config";
import { LocalDiskFileStorageProvider } from "../src/storage/LocalDiskFileStorageProvider";
import { SEED_CONNECTORS, SEED_STORIES } from "../src/seedData/corpus";
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

  // #85 / ADR-0035. Spec §3: on a fresh seed the corpus is fictional, so ratings
  // resolve only after live ingestion. What must hold either way is that an
  // unrated publisher reads as unrated rather than as a guess, and that no row
  // can ever hold a verdict with nobody's name on it.
  describe("publisher leanings", () => {
    it("leaves the invented corpus publishers unrated rather than guessing", async () => {
      const publishers = await AppDataSource.getRepository(Publisher).find();
      expect(publishers.length).toBeGreaterThan(0);
      for (const publisher of publishers) {
        expect(publisher.leaning).toBeNull();
        expect(publisher.leaningSource).toBeNull();
      }
    });

    it("converges a rating onto a real publisher a connector already created", async () => {
      // The catch-up path the migration names: publishers arrive from connectors,
      // and a database migrated before this ticket holds them unrated until a
      // re-seed reads the ratings table over them.
      const publishers = AppDataSource.getRepository(Publisher);
      const held = await publishers.save({ name: "The Guardian", domain: "theguardian.com" });
      expect(held.leaning).toBeNull();

      await seedAll();

      const converged = await publishers.findOneByOrFail({ id: held.id });
      expect(converged.leaning).toBe("left");
      expect(converged.leaningSource).toBe("allsides");
    });

    it("refuses an uncredited or self-credited rating at the schema, not just in code", async () => {
      // The invariant that makes "always displayed with its source named" true of
      // the data and not only of the pages: half a claim cannot be stored at all.
      await expect(
        AppDataSource.query(
          `INSERT INTO "publishers" ("name", "domain", "leaning") VALUES ('Unsourced', 'unsourced.example', 'right')`,
        ),
      ).rejects.toThrow(/publishers_leaning_sourced_check/);
      await expect(
        AppDataSource.query(
          `INSERT INTO "publishers" ("name", "domain", "leaning", "leaningSource")
           VALUES ('Invented', 'invented.example', 'hard-left', 'allsides')`,
        ),
      ).rejects.toThrow(/publishers_leaning_check/);
      // And the credit has to name a rater Tessera reproduces. Without this the
      // pairing above is satisfied by citing ourselves — an inferred verdict
      // wearing a citation as a disguise, which is the one thing ADR-0035 exists
      // to make impossible rather than merely discouraged.
      await expect(
        AppDataSource.query(
          `INSERT INTO "publishers" ("name", "domain", "leaning", "leaningSource")
           VALUES ('Self-cited', 'self-cited.example', 'right', 'tessera')`,
        ),
      ).rejects.toThrow(/publishers_leaning_source_check/);
    });
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

  // #57: the flagship reads a current PromptTemplate on every request, so this row is
  // what makes a migrated database work rather than demo content — which is why the
  // migration inserts it and the seed does not. Asserted here because this is the file
  // about a fresh clone reaching a working demo.
  //
  // The version is asserted against the code constant deliberately: since #57 the prompt
  // is data, so changing what prompt.ts asks for means bumping PROMPT_VERSION *and*
  // shipping a migration that inserts and activates a row carrying the new label. Doing
  // one without the other fails here rather than quietly serving cached analyses written
  // under the old prompt.
  it("ships one current PromptTemplate, carrying the prompt the code asks for", async () => {
    const templates = await AppDataSource.getRepository(PromptTemplate).find({ where: { isCurrent: true } });
    expect(templates).toHaveLength(1);
    expect(templates[0].version).toBe(PROMPT_VERSION);
    expect(templates[0].params).toEqual(DEFAULT_PROMPT_PARAMS);
    // No person behind the shipped version, and nothing it was tuned from.
    expect(templates[0].createdByUserId).toBeNull();
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
    expect(rss.every((connector) => typeof connector.feedProvidesFullText === "boolean")).toBe(true);
    expect(rss.some((connector) => connector.feedProvidesFullText)).toBe(true);
    expect(rss.some((connector) => !connector.feedProvidesFullText)).toBe(true);
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

  // #62: the Curated Corpus's own annotations are the permanent half of the graph
  // (ADR-0029), so they are asserted against the seeded bodies themselves — an
  // occurrence whose offset does not land on its surface name is one a reviewer
  // reading the Article beside the graph would catch, and this is cheaper.
  it("annotates every fixture Article on all four kinds, at offsets in its own text", async () => {
    const rows = await AppDataSource.query(
      `SELECT a."id", a."analysisText", g."kind", g."surfaceName", g."charOffset", g."locationDetail"
       FROM gkg_annotations g JOIN articles a ON a."id" = g."articleId"
       WHERE a."analysisTextMode" = 'manual_fixture'`,
    );
    const fixtureArticles = SEED_STORIES.flatMap((story) => story.articles);
    expect(rows.length).toBeGreaterThanOrEqual(fixtureArticles.length * 4);

    const kindsByArticle = new Map<string, Set<string>>();
    for (const row of rows) {
      kindsByArticle.set(row.id, (kindsByArticle.get(row.id) ?? new Set()).add(row.kind));
      if (row.kind === "theme") {
        // A theme's surface name is GDELT's code, which the body never contains —
        // only its offset is checkable, and it has to be inside the text.
        expect(row.charOffset).toBeLessThan(row.analysisText.length);
      } else {
        expect(row.analysisText.slice(row.charOffset, row.charOffset + row.surfaceName.length)).toBe(row.surfaceName);
      }
      if (row.kind === "location") {
        expect(row.locationDetail).toMatchObject({
          featureId: expect.any(String),
          countryCode: expect.any(String),
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        });
      } else {
        expect(row.locationDetail).toBeNull();
      }
    }
    expect(kindsByArticle.size).toBe(fixtureArticles.length);
    for (const kinds of kindsByArticle.values()) {
      expect([...kinds].sort()).toEqual(["location", "organization", "person", "theme"]);
    }
  });

  // ADR-0019's graph is worth nothing if every node is isolated, and a name that
  // appears in one Story only produces no edge across the corpus.
  it("repeats annotated names across Articles and across Stories", async () => {
    const [{ shared }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS shared FROM (
         SELECT g."surfaceName"
         FROM gkg_annotations g JOIN articles a ON a."id" = g."articleId"
         WHERE a."analysisTextMode" = 'manual_fixture' AND g."kind" IN ('person', 'organization', 'location')
         GROUP BY g."surfaceName"
         HAVING COUNT(DISTINCT a."storyId") > 1
       ) recurring`,
    );
    expect(shared).toBeGreaterThanOrEqual(5);
  });

  it("is idempotent — a re-run after a migration must not duplicate or throw", async () => {
    const repo = AppDataSource.getRepository(IntelligenceBrief);
    const before = await repo.findOneOrFail({ where: { title: SEED_BRIEF_TITLE } });
    const annotations = await AppDataSource.getRepository(GkgAnnotation).count();

    await expect(seedAll()).resolves.not.toThrow();

    expect(await repo.count()).toBe(1);
    expect(await AppDataSource.getRepository(User).count()).toBe(USER_ROLES.length);
    expect(await AppDataSource.getRepository(IngestionConnector).count()).toBe(SEED_CONNECTORS.length);
    // Occurrences are the row identity, so a second pass inserts nothing (#62).
    expect(await AppDataSource.getRepository(GkgAnnotation).count()).toBe(annotations);
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

  // #62 extended every fixture body so it names the entities annotated against it,
  // and offsets are located in that text rather than written by hand — so a database
  // seeded before this ticket holds bodies the authored anchors are not in. A re-seed
  // has to converge the text (and the embedding over it), not throw on the first
  // anchor it cannot find.
  it("converges a fixture body seeded before the annotated text existed", async () => {
    const articles = AppDataSource.getRepository(Article);
    const seedArticle = SEED_STORIES[0].articles[0];
    const before = await articles.findOneByOrFail({ url: seedArticle.url });
    await articles.update({ id: before.id }, { analysisText: seedArticle.analysisText.split(". ")[0] + "." });
    await AppDataSource.query(`UPDATE articles SET "embedding" = NULL WHERE "id" = $1`, [before.id]);

    await expect(seedAll()).resolves.not.toThrow();

    const after = await articles.findOneByOrFail({ url: seedArticle.url });
    expect(after.analysisText).toBe(seedArticle.analysisText);
    const [{ count }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM articles WHERE "embedding" IS NULL`,
    );
    expect(count).toBe(0);
  });

  // #46: a database seeded before the DOC connector had a query would hold an
  // endpoint no run can succeed against. #47 likewise has to classify RSS rows
  // created before the extraction policy existed. `enabled` deliberately does
  // not converge — an Admin who turned a connector off must not have a re-seed
  // turn it back on.
  it("converges stale connector configuration without overriding an Admin's enabled flag", async () => {
    const repo = AppDataSource.getRepository(IngestionConnector);
    const docSeed = SEED_CONNECTORS.find((connector) => connector.kind === "gdelt_doc")!;
    const rssSeed = SEED_CONNECTORS.find((connector) => connector.kind === "rss")!;
    // Restored either way: a failure here must not leave connectors disabled for
    // whatever test runs next.
    try {
      await repo.update(
        { name: docSeed.name },
        { endpoint: "https://api.gdeltproject.org/api/v2/doc/doc", enabled: false },
      );
      await repo.update({ name: rssSeed.name }, { feedProvidesFullText: null, enabled: false });

      await seedAll();

      const doc = await repo.findOneByOrFail({ name: docSeed.name });
      expect(doc.endpoint).toBe(docSeed.endpoint);
      expect(doc.enabled).toBe(false);
      const rss = await repo.findOneByOrFail({ name: rssSeed.name });
      expect(rss.feedProvidesFullText).toBe(rssSeed.feedProvidesFullText);
      expect(rss.enabled).toBe(false);
    } finally {
      await repo.update({ name: docSeed.name }, { enabled: docSeed.enabled });
      await repo.update({ name: rssSeed.name }, { enabled: rssSeed.enabled });
    }
  });

  // #62/ADR-0028: the firehose half of the graph ages out, the curated half does
  // not. Retention already excludes a fixture Article three times over (no
  // discovering connector, `manual_fixture`, a storyId), so this asserts the
  // consequence rather than the clause — backdate every row past the window and
  // the curated corpus and its annotations are still there.
  it("leaves fixture Articles and their annotations out of the retention window", async () => {
    const articles = AppDataSource.getRepository(Article);
    const annotations = AppDataSource.getRepository(GkgAnnotation);
    const before = { articles: await articles.count(), annotations: await annotations.count() };
    await AppDataSource.query(`UPDATE articles SET "createdAt" = '2020-01-01T00:00:00Z'`);

    expect(await pruneExpiredGdeltArticles()).toBe(0);

    expect(await articles.count()).toBe(before.articles);
    expect(await annotations.count()).toBe(before.annotations);
  });
});
