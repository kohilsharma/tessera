import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User, USER_ROLES, UserRole } from "../entities/User";
import { IntelligenceBrief } from "../entities/IntelligenceBrief";
import { ClusteringRun } from "../entities/ClusteringRun";
import { IngestionConnector } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { Publisher } from "../entities/Publisher";
import { Story } from "../entities/Story";
import type { StoryCategory } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { MIN_DISTINCT_PUBLISHERS } from "../generation/config";
import { toPublicIngestionRun } from "../lib/ingestionRunView";
import { acceptedMembership } from "../lib/storyMembership";

export const dashboardRouter = Router();

// Deep enough to tell a feed that has been failing all morning from one that
// failed once; shallow enough that the Admin payload has a fixed ceiling.
const RECENT_INGESTION_RUNS = 20;

// The clustering history is read the same way and capped for the same reason. Its
// own constant because the two registers are read differently: a feed's runs are
// diagnosed per connector, a clustering pass is one series.
const RECENT_CLUSTERING_RUNS = 20;

// #56: how many Stories the Investor surface offers a comparative reading of. A
// landing page, not an index — /stories is where a reader goes for all of them.
const COMPARABLE_STORIES = 10;

// ADR-0004: Student and Investor are genuinely distinct endpoints/data, not one
// shared shape with a role flag — each route below returns its own field set.
// Student study collections are backed by owned Briefs; Investor sectors are
// the corpus rolled up by category; Admin inspects operator-only rows.
dashboardRouter.get(
  "/dashboard/student",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const studyCollections = await AppDataSource.getRepository(IntelligenceBrief).find({
      where: { ownerId: req.user!.id },
      select: { id: true, title: true, category: true },
      order: { updatedAt: "DESC" },
    });
    res.json({ role: "student", studyCollections });
  }),
);

// #56: the Investor surface's route into the consensus/contradiction reading — the
// Stories a comparative analysis can actually be written about, newest movement
// first. The conditions are evidence selection's own (generation/evidence.ts):
// accepted membership, analysis text with something in it, an embedding, and
// ADR-0027's minimum of two distinct Publishers. Stated as one query rather than
// inferred from the sector rollup, because "covered" and "comparable" are different
// facts and a row that refuses when opened is worse than no row.
//
// It counts mastheads, not newsrooms: the wire-copy collapse happens inside an
// EvidenceSet, over vectors, and running it here would mean an O(n²) pair scan per
// Story on a landing page. So a Story that is one wire report under two mastheads can
// still be listed, and the generation endpoint refuses it on opening with the reason
// stated — which is why the register says publishers rather than promising an
// analysis. Undercounting the other way is not possible, which is the direction that
// would hide reporting.
//
// ponytail: the grouping runs over every accepted, text-bearing, embedded Article in
// the corpus and only then takes ten Stories, so the work grows with the corpus rather
// than with the page. Fine at a demo corpus and at a week of the firehose, since
// retention keeps `metadata_only` rows from accumulating; the upgrade is a `lastSeenAt`
// window in the join before the aggregate.
async function comparableStories(): Promise<
  { id: string; title: string; category: StoryCategory; publisherCount: number; lastSeenAt: Date }[]
> {
  const rows: {
    id: string;
    title: string;
    category: StoryCategory;
    publisherCount: string;
    lastSeenAt: Date;
  }[] = await AppDataSource.query(
    `SELECT s."id", s."title", s."category", s."lastSeenAt",
            COUNT(DISTINCT a."publisherId") AS "publisherCount"
       FROM "stories" s
       JOIN "articles" a ON a."storyId" = s."id" AND ${acceptedMembership("a")}
        AND a."analysisText" ~ '[^[:space:]]' AND a."embedding" IS NOT NULL
      GROUP BY s."id"
     HAVING COUNT(DISTINCT a."publisherId") >= $1
      ORDER BY s."lastSeenAt" DESC, s."title" ASC
      LIMIT $2`,
    [MIN_DISTINCT_PUBLISHERS, COMPARABLE_STORIES],
  );
  // Deliberately not an article count: the eligible members counted here are a subset
  // of the accepted members `/stories` counts, and one Story reading "5 Articles" on
  // the dashboard and "7 articles" one click later would be two facts under one word.
  return rows.map((row) => ({ ...row, publisherCount: Number(row.publisherCount) }));
}

// The Investor surface is market context over the corpus (CONTEXT.md: Investor
// = "watchlist/sectors"). Sectors are the Story category vocabulary rolled up
// with live coverage counts — real data from the Phase-1 schema, and a shape
// the Student endpoint never returns. A saved, per-user watchlist needs its own
// entity and lands with the Investor generation features (ADR-0021).
dashboardRouter.get(
  "/dashboard/investor",
  requireAuth,
  requireRole("investor"),
  asyncHandler(async (_req, res) => {
    const sectors = await AppDataSource.getRepository(Story)
      .createQueryBuilder("story")
      .select("story.category", "category")
      .addSelect("COUNT(DISTINCT story.id)", "storyCount")
      .addSelect("COUNT(article.id)", "articleCount")
      // Accepted members only (#50), as on browse: a rollup counting proposals
      // would state coverage no Investor can reach.
      .leftJoin("story.articles", "article", acceptedMembership("article"))
      .groupBy("story.category")
      .orderBy("story.category", "ASC")
      .getRawMany<{ category: StoryCategory; storyCount: string; articleCount: string }>();

    res.json({
      role: "investor",
      sectors: sectors.map((row) => ({
        category: row.category,
        storyCount: Number(row.storyCount),
        articleCount: Number(row.articleCount),
      })),
      comparableStories: await comparableStories(),
    });
  }),
);

// ADR-0004's Admin surface is connectors / clustering review / generation
// inspection. Connectors and Publishers exist and are seed-only in Phase 1, so
// the dashboard inspects them read-only; clustering and generation review join
// it with the tickets that create their entities.
dashboardRouter.get(
  "/dashboard/admin",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const rows = await AppDataSource.getRepository(User)
      .createQueryBuilder("user")
      .select("user.role", "role")
      .addSelect("COUNT(*)", "count")
      .groupBy("user.role")
      .getRawMany<{ role: UserRole; count: string }>();

    // Every role present with a zero, not just the ones with rows, so the client
    // never has to decide whether a missing key means zero or means unknown.
    const userCounts = Object.fromEntries(USER_ROLES.map((role) => [role, 0])) as Record<UserRole, number>;
    for (const row of rows) userCounts[row.role] = Number(row.count);

    const connectors = await AppDataSource.getRepository(IngestionConnector).find({
      select: { id: true, name: true, kind: true, endpoint: true, enabled: true },
      order: { name: "ASC" },
    });

    // ADR-0024: run history is read from Postgres, never from the queue, so this
    // panel renders whether or not the worker (#42) is running. Newest first, and
    // capped — an operator diagnosing a feed reads the last few runs, and an
    // unbounded history would grow the Admin payload without bound.
    const ingestionRuns = await AppDataSource.getRepository(IngestionRun).find({
      relations: { connector: true },
      order: { startedAt: "DESC" },
      take: RECENT_INGESTION_RUNS,
    });

    // ADR-0026: the same rule as ingestion history — read from Postgres, never the
    // queue, so this register renders with the worker stopped. Served whole: every
    // column on a ClusteringRun is a count an operator reads, so there is nothing
    // to project away.
    const clusteringRuns = await AppDataSource.getRepository(ClusteringRun).find({
      order: { startedAt: "DESC" },
      take: RECENT_CLUSTERING_RUNS,
    });

    const publishers = await AppDataSource.getRepository(Publisher)
      .createQueryBuilder("publisher")
      .loadRelationCountAndMap("publisher.articleCount", "publisher.articles")
      .orderBy("publisher.name", "ASC")
      .getMany();

    res.json({
      role: "admin",
      userCounts,
      connectors,
      ingestionRuns: ingestionRuns.map((run) => toPublicIngestionRun(run, run.connector.name)),
      clusteringRuns,
      publishers: (publishers as (Publisher & { articleCount?: number })[]).map((publisher) => ({
        id: publisher.id,
        name: publisher.name,
        domain: publisher.domain,
        // CONTEXT.md "Terms Class" (#40): assigned by hand, so an operator has to
        // be able to see which sources are cleared and which are still at the
        // fail-closed default.
        termsClass: publisher.termsClass,
        articleCount: publisher.articleCount ?? 0,
      })),
    });
  }),
);
