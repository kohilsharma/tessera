import "reflect-metadata";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { AppDataSource } from "./data-source";
import { User, USER_ROLES, UserRole } from "./entities/User";
import { Publisher } from "./entities/Publisher";
import { Story } from "./entities/Story";
import { Article } from "./entities/Article";
import { BriefArticle } from "./entities/BriefArticle";
import { DEFAULT_ARTICLE_CAPACITY_LIMIT, IntelligenceBrief } from "./entities/IntelligenceBrief";
import type { StoryCategory } from "./entities/Story";
import { createEmbeddingProvider } from "./embeddings";
import { toVectorLiteral } from "./embeddings/pgvector";
import { SEED_PUBLISHERS, SEED_STORIES } from "./seedData/corpus";
import { seedCoverImagePng } from "./seedData/coverImage";
import { LocalDiskFileStorageProvider } from "./storage/LocalDiskFileStorageProvider";

// ADR-0015: `npm run seed` so the demo is never empty. Admin is deliberately not
// registrable through /auth/register (it is assigned, not self-served), so this
// is the only way an Admin exists in a running app — without it the Admin
// dashboard and its role guard are only reachable from a test fixture. Briefs
// join this as the ticket that creates them lands.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "tessera-demo";

// One derivation of the demo addresses: seedBrief looks its owner up by the
// same rule seedUsers creates them by, and a literal in the second place is a
// rename away from a findOneOrFail at demo time.
const seedEmail = (role: UserRole): string => `${role}@tessera.local`;

async function seedUsers(): Promise<void> {
  const users = AppDataSource.getRepository(User);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // Idempotent: re-running after a migration or a partial demo must not 409 on
  // the email UNIQUE constraint, and must not silently reset a changed password.
  for (const role of USER_ROLES) {
    const email = seedEmail(role);
    if (await users.findOne({ where: { email } })) {
      console.log(`= ${email} already seeded (${role})`);
      continue;
    }
    await users.save({ email, passwordHash, role });
    console.log(`+ ${email} (${role})`);
  }
}

// #19/#23: seeds the browsable corpus, embedded with whichever EmbeddingProvider
// createEmbeddingProvider() selects (hosted if GEMINI_API_KEY is set, Mock
// otherwise) so the app is never empty and re-running is reproducible.
async function seedCorpus(): Promise<void> {
  const publishers = AppDataSource.getRepository(Publisher);
  const stories = AppDataSource.getRepository(Story);
  const articles = AppDataSource.getRepository(Article);
  const embedder = createEmbeddingProvider();

  const publisherByDomain = new Map<string, Publisher>();
  for (const seedPublisher of SEED_PUBLISHERS) {
    let publisher = await publishers.findOne({ where: { domain: seedPublisher.domain } });
    if (!publisher) {
      publisher = await publishers.save(seedPublisher);
      console.log(`+ publisher ${seedPublisher.domain}`);
    }
    publisherByDomain.set(seedPublisher.domain, publisher);
  }

  for (const seedStory of SEED_STORIES) {
    if (await stories.findOne({ where: { slug: seedStory.slug } })) {
      console.log(`= story ${seedStory.slug} already seeded`);
      continue;
    }

    const publishedTimes = seedStory.articles.map((a) => new Date(a.publishedAt).getTime());
    const story = await stories.save({
      slug: seedStory.slug,
      title: seedStory.title,
      summary: seedStory.summary,
      category: seedStory.category,
      firstSeenAt: new Date(Math.min(...publishedTimes)),
      lastSeenAt: new Date(Math.max(...publishedTimes)),
    });

    for (const seedArticle of seedStory.articles) {
      const publisher = publisherByDomain.get(seedArticle.publisherDomain);
      if (!publisher) throw new Error(`Unknown publisher domain in fixture: ${seedArticle.publisherDomain}`);

      const saved = await articles.save({
        storyId: story.id,
        publisherId: publisher.id,
        title: seedArticle.title,
        url: seedArticle.url,
        analysisText: seedArticle.analysisText,
        analysisTextType: "manual_fixture",
        publishedAt: new Date(seedArticle.publishedAt),
      });

      const vector = await embedder.embed(`${seedArticle.title}\n${seedArticle.analysisText}`);
      await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
        toVectorLiteral(vector),
        saved.id,
      ]);
    }
    console.log(`+ story ${seedStory.slug} (${seedStory.articles.length} articles)`);
  }
}

// #23: the Phase-1 exit criterion needs at least one owned Brief with Articles
// already attached, not just an empty shell a demoer has to fill in live.
const SEED_BRIEF_TITLE = "AI Accelerator Supply Chain Watch";
const SEED_BRIEF_STORY_SLUG = "advanced-packaging-capacity-race";
const SEED_BRIEF_CATEGORY: StoryCategory = "technology";

// The mandated media field, populated the way an upload would leave it: the same
// server-generated key shape as routes/briefs.ts, written through the same
// FileStorageProvider seam rather than straight to disk.
async function attachCoverImage(briefId: string): Promise<void> {
  const coverImageKey = `${briefId}-${randomUUID()}.png`;
  await new LocalDiskFileStorageProvider().save(coverImageKey, seedCoverImagePng(), "image/png");
  await AppDataSource.getRepository(IntelligenceBrief).update({ id: briefId }, { coverImageKey });
  console.log(`+ cover image for brief "${SEED_BRIEF_TITLE}"`);
}

async function seedBrief(): Promise<void> {
  const briefs = AppDataSource.getRepository(IntelligenceBrief);
  const briefArticles = AppDataSource.getRepository(BriefArticle);
  const users = AppDataSource.getRepository(User);
  const articles = AppDataSource.getRepository(Article);

  const existing = await briefs.findOne({ where: { title: SEED_BRIEF_TITLE } });
  if (existing) {
    console.log(`= brief "${SEED_BRIEF_TITLE}" already seeded`);
    // Still converge on the cover: a DB seeded before the media field was part
    // of the fixture would otherwise stay short of the demo state forever, and
    // re-running the seed is the documented way to catch up after a migration.
    // Only when it's null — never clobber a cover the owner uploaded.
    if (!existing.coverImageKey) await attachCoverImage(existing.id);
    return;
  }

  const owner = await users.findOneOrFail({ where: { email: seedEmail("student") } });
  const storyArticles = await articles.find({
    where: { story: { slug: SEED_BRIEF_STORY_SLUG } },
    relations: { story: true },
  });

  const brief = await briefs.save({
    title: SEED_BRIEF_TITLE,
    note: "Tracking packaging capacity announcements across the AI-accelerator supply chain.",
    category: SEED_BRIEF_CATEGORY,
    articleCapacityLimit: DEFAULT_ARTICLE_CAPACITY_LIMIT,
    ownerId: owner.id,
  });
  // routes/briefs.ts refuses an attach past articleCapacityLimit; seeding writes
  // BriefArticle rows directly, so it has to honour the same cap itself rather
  // than hand the demo a Brief the API would never have let anyone build.
  const attached = storyArticles.slice(0, DEFAULT_ARTICLE_CAPACITY_LIMIT);
  for (const article of attached) {
    await briefArticles.save({ briefId: brief.id, articleId: article.id });
  }

  await attachCoverImage(brief.id);

  console.log(`+ brief "${SEED_BRIEF_TITLE}" (${attached.length} articles, cover image)`);
}

// Exported without the connection lifecycle around it so a test can run the
// real seed against an already-initialized DataSource (see tests/seed.test.ts)
// — the exit criterion in #23 is "a fresh clone reaches a populated demo", and
// asserting that against the actual seed is the only way it stays true.
export async function seedAll(): Promise<void> {
  await seedUsers();
  await seedCorpus();
  await seedBrief();
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  await seedAll();
  console.log(`\nDemo login password for all seeded users: ${SEED_PASSWORD}`);
  await AppDataSource.destroy();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Seed failed", err);
    process.exit(1);
  });
}
