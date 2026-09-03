import "reflect-metadata";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { AppDataSource } from "./data-source";
import { User, USER_ROLES, UserRole } from "./entities/User";
import { Publisher } from "./entities/Publisher";
import { Story } from "./entities/Story";
import { Article } from "./entities/Article";
import { BriefArticle } from "./entities/BriefArticle";
import { IngestionConnector } from "./entities/IngestionConnector";
import { DEFAULT_ARTICLE_CAPACITY_LIMIT, IntelligenceBrief } from "./entities/IntelligenceBrief";
import type { StoryCategory } from "./entities/Story";
import { createEmbeddingProvider } from "./embeddings";
import type { EmbeddingProvider } from "./embeddings/EmbeddingProvider";
import { toVectorLiteral } from "./embeddings/pgvector";
import { stageAnnotations } from "./ingestion/runConnector";
import { seedAnnotationsFor } from "./seedData/annotations";
import { SEED_CONNECTORS, SEED_PUBLISHERS, SEED_STORIES } from "./seedData/corpus";
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

// #19/#23: seeds the browsable corpus with whichever configured
// EmbeddingProvider createEmbeddingProvider() selects, or the Mock when no
// hosted key is configured, so the app is never empty and reruns are reproducible.
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
    } else if (publisher.termsClass !== seedPublisher.termsClass) {
      // A database seeded before #40 has every Publisher at the old fail-closed
      // `internal_only` default, which would stop the demo corpus serving its own
      // fixture text. ADR-0032's migration backfills that class anyway; this
      // converges the fixture domains whatever they hold, the same way seedBrief
      // converges a missing cover image — and only for domains the seed owns.
      await publishers.update({ id: publisher.id }, { termsClass: seedPublisher.termsClass });
      publisher.termsClass = seedPublisher.termsClass;
      console.log(`~ publisher ${seedPublisher.domain} terms class -> ${seedPublisher.termsClass}`);
    }
    publisherByDomain.set(seedPublisher.domain, publisher);
  }

  for (const seedStory of SEED_STORIES) {
    if (await stories.findOne({ where: { slug: seedStory.slug } })) {
      // #62 extended every fixture body so it names the entities annotated against
      // it, and offsets are located in that text at seed time — so a database
      // seeded before this ticket holds bodies whose anchors do not resolve, and
      // the annotation pass below would throw rather than catch up. Converge the
      // text and re-embed exactly the Articles that changed, the same way the
      // terms class converges above.
      const changed: { id: string; text: string }[] = [];
      for (const seedArticle of seedStory.articles) {
        const held = await articles.findOne({ where: { url: seedArticle.url } });
        if (!held || held.analysisText === seedArticle.analysisText) continue;
        await articles.update({ id: held.id }, { analysisText: seedArticle.analysisText });
        changed.push({ id: held.id, text: `${seedArticle.title}\n${seedArticle.analysisText}` });
      }
      await embedInto(changed, embedder);
      console.log(
        changed.length === 0
          ? `= story ${seedStory.slug} already seeded`
          : `~ story ${seedStory.slug} text converged (${changed.length} articles)`,
      );
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

    const pending: { id: string; text: string }[] = [];
    for (const seedArticle of seedStory.articles) {
      const publisher = publisherByDomain.get(seedArticle.publisherDomain);
      if (!publisher) throw new Error(`Unknown publisher domain in fixture: ${seedArticle.publisherDomain}`);

      const saved = await articles.save({
        storyId: story.id,
        storyAssignmentStatus: "auto_accepted" as const,
        storyAssignmentScore: 1,
        publisherId: publisher.id,
        title: seedArticle.title,
        url: seedArticle.url,
        analysisText: seedArticle.analysisText,
        analysisTextMode: "manual_fixture",
        publishedAt: new Date(seedArticle.publishedAt),
      });

      pending.push({ id: saved.id, text: `${seedArticle.title}\n${seedArticle.analysisText}` });
    }

    // One request for the whole story rather than one per article.
    await embedInto(pending, embedder);
    console.log(`+ story ${seedStory.slug} (${seedStory.articles.length} articles)`);
  }
}

// Hosted providers meter *requests* — NVIDIA's free tier is ~40/min across the key
// — so batching is the difference between seeding in seconds and tripping a rate
// limiter. Shared by the insert and the convergence path above, which re-embeds
// only the rows whose text it just replaced.
async function embedInto(pending: { id: string; text: string }[], embedder: EmbeddingProvider): Promise<void> {
  if (pending.length === 0) return;
  const vectors = await embedder.embedBatch(pending.map((p) => p.text), "passage");
  for (const [i, row] of pending.entries()) {
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
      toVectorLiteral(vectors[i]),
      row.id,
    ]);
  }
}

// Seed-only in Phase 1 (ADR-0022): these give the Admin dashboard real
// connectors to inspect. Ingestion reads them in Phase 2.
async function seedConnectors(): Promise<void> {
  const connectors = AppDataSource.getRepository(IngestionConnector);
  // #39 replaced the `meridianwire.example` placeholder with real feeds. The seed
  // is idempotent by name and never deletes, so a database seeded before that
  // would keep an RSS connector pointing at a domain that cannot resolve —
  // converge it away, the same way seedBrief converges a missing cover image.
  await connectors.delete({ name: "Meridian Wire RSS" });

  for (const seedConnector of SEED_CONNECTORS) {
    const held = await connectors.findOne({ where: { name: seedConnector.name } });
    if (held) {
      // Connector-owned configuration converges; `enabled` deliberately does
      // not. #46 gave DOC its required query and #47 records which RSS feeds leave
      // an extraction backlog, but an Admin who turned a connector off must not
      // have it turned back on by a re-seed.
      if (
        held.endpoint !== seedConnector.endpoint ||
        held.feedProvidesFullText !== seedConnector.feedProvidesFullText
      ) {
        await connectors.update(
          { id: held.id },
          { endpoint: seedConnector.endpoint, feedProvidesFullText: seedConnector.feedProvidesFullText },
        );
        console.log(`~ connector ${seedConnector.name} configuration converged`);
      } else {
        console.log(`= connector ${seedConnector.name} already seeded`);
      }
      continue;
    }
    await connectors.save(seedConnector);
    console.log(`+ connector ${seedConnector.name} (${seedConnector.kind})`);
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

// #62. The Curated Corpus's own GKG Annotations. A separate pass rather than part
// of seedCorpus, because seedCorpus skips a Story it already holds — a database
// seeded before this ticket would otherwise never get them, the same reason the
// cover image and the connector endpoints converge above.
//
// Idempotent for free: occurrences are the row identity (migration 1755751000000)
// and stageAnnotations inserts with ORIGNORE, so re-seeding stages nothing twice
// and deletes nothing.
async function seedAnnotations(): Promise<void> {
  const articles = AppDataSource.getRepository(Article);
  let staged = 0;
  for (const seedStory of SEED_STORIES) {
    for (const seedArticle of seedStory.articles) {
      const held = await articles.findOneOrFail({ where: { url: seedArticle.url } });
      staged += await stageAnnotations(AppDataSource.manager, held.id, seedAnnotationsFor(seedArticle));
    }
  }
  console.log(staged === 0 ? "= GKG annotations already seeded" : `+ ${staged} GKG annotations`);
}

// Exported without the connection lifecycle around it so a test can run the
// real seed against an already-initialized DataSource (see tests/seed.test.ts)
// — the exit criterion in #23 is "a fresh clone reaches a populated demo", and
// asserting that against the actual seed is the only way it stays true.
export async function seedAll(): Promise<void> {
  await seedUsers();
  await seedCorpus();
  await seedAnnotations();
  await seedConnectors();
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
