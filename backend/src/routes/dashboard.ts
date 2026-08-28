import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User, USER_ROLES, UserRole } from "../entities/User";
import { IntelligenceBrief } from "../entities/IntelligenceBrief";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const dashboardRouter = Router();

// ADR-0004: Student and Investor are genuinely distinct endpoints/data, not one
// shared shape with a role flag — each route below returns its own field set.
// Student study collections are backed by owned Briefs; Investor watchlist data
// remains deferred until its entity lands.
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

dashboardRouter.get("/dashboard/investor", requireAuth, requireRole("investor"), (_req, res) => {
  res.json({ role: "investor", watchlist: [] });
});

// ADR-0004's Admin surface is connectors / clustering review / generation
// inspection, none of which have entities yet. Role counts are the one piece of
// operator-only data the current schema can answer honestly, so the Admin
// dashboard is real rather than an empty placeholder; connectors and clustering
// review join it with the tickets that create them.
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

    res.json({ role: "admin", userCounts });
  }),
);
