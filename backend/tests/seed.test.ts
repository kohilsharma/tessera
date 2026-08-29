import { describe, expect, it, beforeAll } from "vitest";
import { AppDataSource } from "../src/data-source";
import { IntelligenceBrief } from "../src/entities/IntelligenceBrief";
import { User, USER_ROLES } from "../src/entities/User";
import { Story } from "../src/entities/Story";
import { BriefArticle } from "../src/entities/BriefArticle";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { LocalDiskFileStorageProvider } from "../src/storage/LocalDiskFileStorageProvider";
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

  it("seeds the IngestionConnectors the Admin dashboard inspects", async () => {
    const connectors = await AppDataSource.getRepository(IngestionConnector).find();
    expect(connectors.length).toBeGreaterThan(0);
    expect(connectors.map((c) => c.kind)).toContain("gdelt_gkg");
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
    expect(await AppDataSource.getRepository(IngestionConnector).count()).toBe(3);
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
});
