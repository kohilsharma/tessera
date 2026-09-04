import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { GenerationRun, type GenerationLens } from "../entities/GenerationRun";
import { Story } from "../entities/Story";
import type { UserRole } from "../entities/User";
import { isGenerationLens, lensForRole } from "../generation/config";
import { loadGenerationView, runGeneration } from "../generation/runGeneration";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { createSynthesisProvider, synthesisProviderIdentity } from "../synthesis";
import { isUuid } from "../lib/uuid";
import { ACCEPTED_ASSIGNMENT } from "../lib/storyMembership";

export const generationRouter = Router();

function resolveLens(requested: unknown, role: UserRole): GenerationLens | { error: string } {
  const derived = lensForRole(role);
  if (requested !== undefined && derived) {
    return { error: "Your Lens is derived from your role and cannot be chosen" };
  }
  if (!derived && !isGenerationLens(requested)) {
    return { error: "lens must be one of: student_context, investor_implication" };
  }
  return (derived ?? requested) as GenerationLens;
}

generationRouter.get(
  "/stories/:id/analysis",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    const story = await AppDataSource.getRepository(Story).findOneBy({ id: req.params.id });
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    const resolved = resolveLens(req.query.lens, req.user!.role);
    if (typeof resolved === "object") {
      res.status(422).json({ error: resolved.error });
      return;
    }
    const hasAcceptedMember = await AppDataSource.getRepository(Article).countBy({
      storyId: story.id,
      storyAssignmentStatus: ACCEPTED_ASSIGNMENT,
    });
    if (hasAcceptedMember === 0) {
      res.json(null);
      return;
    }
    const lens = resolved;
    const run = await AppDataSource.getRepository(GenerationRun).findOne({
      where: { storyId: story.id, lens, status: "completed" },
      order: { completedAt: "DESC" },
    });
    res.json(run ? await loadGenerationView(run.id) : null);
  }),
);

// The flagship's one endpoint. A POST because it may spend money and create rows,
// singular because a Story has one current analysis per Lens (ADR-0027) — asking
// twice for the same evidence under the same Lens returns the run that already
// exists rather than making a second one.
//
// Synchronous: it answers with the finished run. A completed run and a failed run are
// both 200, because both are the honest answer to "what is the analysis of this
// Story" — the failure is *in* the run, stated as a `failureCode` a reader can be
// shown, which is what "never silently serve invalid intelligence" (ADR-0010) looks
// like on a screen. A 502 would make it a transport problem and lose the run id an
// Admin needs to read the row.
generationRouter.post(
  "/stories/:id/analysis",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    const story = await AppDataSource.getRepository(Story).findOneBy({ id: req.params.id });
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    // ADR-0027: the Lens comes from the role, and only an Admin names it. A Student
    // asking for the investor Lens is refused rather than quietly given their own —
    // silently substituting would make the response a lie about what was asked.
    const resolved = resolveLens((req.body ?? {}).lens, req.user!.role);
    if (typeof resolved === "object") {
      res.status(422).json({ error: resolved.error });
      return;
    }
    const lens = resolved;

    const provider = createSynthesisProvider();
    const outcome = await runGeneration(
      { synth: provider, ...synthesisProviderIdentity() },
      { storyId: story.id, lens, triggeredByUserId: req.user!.id },
    );
    if (outcome.status === "no_evidence") {
      res.status(422).json({ error: "This Story has no reporting available to analyse" });
      return;
    }
    // v3 §16.2's minimum distinct Publishers, after the wire-copy collapse: five
    // outlets running one wire report are one source, and an analysis of how the
    // coverage compares needs something to compare it with.
    if (outcome.status === "insufficient_publishers") {
      res.status(422).json({ error: "This Story needs independent reporting from at least two publishers to analyse" });
      return;
    }
    res.json({ ...outcome.view, reused: outcome.status === "reused" });
  }),
);
