import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User, USER_ROLES, UserRole } from "../entities/User";
import { IntelligenceBrief } from "../entities/IntelligenceBrief";
import { IngestionConnector } from "../entities/IngestionConnector";
import { Publisher } from "../entities/Publisher";
import { Story } from "../entities/Story";
import type { StoryCategory } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const dashboardRouter = Router();

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
      .leftJoin("story.articles", "article")
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

    const publishers = await AppDataSource.getRepository(Publisher)
      .createQueryBuilder("publisher")
      .loadRelationCountAndMap("publisher.articleCount", "publisher.articles")
      .orderBy("publisher.name", "ASC")
      .getMany();

    res.json({
      role: "admin",
      userCounts,
      connectors,
      publishers: (publishers as (Publisher & { articleCount?: number })[]).map((publisher) => ({
        id: publisher.id,
        name: publisher.name,
        domain: publisher.domain,
        articleCount: publisher.articleCount ?? 0,
      })),
    });
  }),
);
