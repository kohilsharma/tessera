import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Story } from "../entities/Story";
import { isGenerationLens, lensForRole } from "../generation/config";
import { runGeneration } from "../generation/runGeneration";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { createSynthesisProvider, synthesisProviderIdentity } from "../synthesis";
import { isUuid } from "../lib/uuid";

export const generationRouter = Router();

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
    const requested = (req.body ?? {}).lens;
    const derived = lensForRole(req.user!.role);
    if (requested !== undefined && derived) {
      res.status(422).json({ error: "Your Lens is derived from your role and cannot be chosen" });
      return;
    }
    if (!derived && !isGenerationLens(requested)) {
      res.status(422).json({ error: "lens must be one of: student_context, investor_implication" });
      return;
    }
    const lens = derived ?? requested;

    const provider = createSynthesisProvider();
    const outcome = await runGeneration(
      { synth: provider, ...synthesisProviderIdentity() },
      { storyId: story.id, lens, triggeredByUserId: req.user!.id },
    );
    if (outcome.status === "no_evidence") {
      res.status(422).json({ error: "This Story has no reporting available to analyse" });
      return;
    }
    res.json({ ...outcome.view, reused: outcome.status === "reused" });
  }),
);
