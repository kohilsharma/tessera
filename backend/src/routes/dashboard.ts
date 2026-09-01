import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User, USER_ROLES, UserRole } from "../entities/User";
import { IntelligenceBrief } from "../entities/IntelligenceBrief";
import { ClusteringRun } from "../entities/ClusteringRun";
import { IngestionConnector } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { Publisher } from "../entities/Publisher";
import { PromptTemplate } from "../entities/PromptTemplate";
import { Story } from "../entities/Story";
import type { StoryCategory } from "../entities/Story";
import { loadStudySummary } from "../flashcards/deck";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { MAX_REQUESTED_CLAIMS, MIN_SURVIVING_CLAIMS } from "../generation/config";
import { comparableStories } from "../generation/evidence";
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

// #57: prompt versions are not capped the way the run histories beside them are — a
// version exists only because an operator created it, so the list grows at human rate,
// not corpus rate. And it has to be whole: a past run's promptVersion is traceable only
// while the label it names is still readable somewhere, and this is the only surface
// that reads them.

// ADR-0004: Student and Investor are genuinely distinct endpoints/data, not one
// shared shape with a role flag — each route below returns its own field set.
// Student study collections are backed by owned Briefs; Investor sectors are
// the corpus rolled up by category; Admin inspects operator-only rows.
dashboardRouter.get(
  "/dashboard/student",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const [studyCollections, flashcards] = await Promise.all([
      AppDataSource.getRepository(IntelligenceBrief).find({
        where: { ownerId: req.user!.id },
        select: { id: true, title: true, category: true },
        order: { updatedAt: "DESC" },
      }),
      loadStudySummary(req.user!.id),
    ]);
    res.json({ role: "student", studyCollections, flashcards });
  }),
);

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

    // #57: newest first, and the current one marked. Prior versions are retained, so an
    // Admin reading a past run's promptVersion can find the parameters that wrote it.
    const promptTemplates = await AppDataSource.getRepository(PromptTemplate).find({
      order: { createdAt: "DESC" },
    });

    res.json({
      role: "admin",
      userCounts,
      connectors,
      ingestionRuns: ingestionRuns.map((run) => toPublicIngestionRun(run, run.connector.name)),
      clusteringRuns,
      promptClaimCountRange: { min: MIN_SURVIVING_CLAIMS, max: MAX_REQUESTED_CLAIMS },
      promptTemplates: promptTemplates.map((template) => ({
        id: template.id,
        version: template.version,
        params: template.params,
        isCurrent: template.isCurrent,
        createdAt: template.createdAt,
      })),
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
