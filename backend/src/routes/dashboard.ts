import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const dashboardRouter = Router();

function userRepo() {
  return AppDataSource.getRepository(User);
}

// ADR-0004: Student and Investor are genuinely distinct endpoints/data, not one
// shared shape with a role flag — each route below returns its own field set.
// The corpus/Brief-shaped content these will surface (study collections,
// watchlist) lands with #19/#20; this ticket proves the RBAC seam is real.
dashboardRouter.get(
  "/dashboard/student",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (_req, res) => {
    res.json({ role: "student", studyCollections: [] });
  }),
);

dashboardRouter.get(
  "/dashboard/investor",
  requireAuth,
  requireRole("investor"),
  asyncHandler(async (_req, res) => {
    res.json({ role: "investor", watchlist: [] });
  }),
);

dashboardRouter.get(
  "/dashboard/admin",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const rows = await userRepo()
      .createQueryBuilder("user")
      .select("user.role", "role")
      .addSelect("COUNT(*)", "count")
      .groupBy("user.role")
      .getRawMany<{ role: UserRole; count: string }>();

    const userCounts: Record<UserRole, number> = { student: 0, investor: 0, admin: 0 };
    for (const row of rows) userCounts[row.role] = Number(row.count);

    res.json({ role: "admin", userCounts });
  }),
);
