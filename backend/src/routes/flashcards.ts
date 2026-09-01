import { Router } from "express";
import { generateDeck, loadStudyDeck, reviewCard } from "../flashcards/deck";
import { MAX_STUDY_DETAIL_LENGTH } from "../flashcards/questions";
import { isReviewGrade, MAX_REVIEW_GRADE, MIN_REVIEW_GRADE } from "../flashcards/sm2";
import { loadReaderRun } from "../generation/readerRun";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { createSynthesisProvider } from "../synthesis";
import { isUuid } from "../lib/uuid";

export const flashcardsRouter = Router();

// ADR-0021's Student feature (#58). Path-scoped rather than a bare `use`, for the
// reason briefs.ts spells out: an unpathed router-level guard 403s every request
// Express routes into this router, including paths it does not serve.
//
// Student-only, and that is the whole of the access rule — an Investor or an Admin
// gets 403 here, and every query below is filtered by `req.user.id`, so one Student
// cannot reach another's cards even by id (ADR-0004).
flashcardsRouter.use("/flashcards", requireAuth, requireRole("student"));

// Making a deck. A POST because it creates rows and may spend money — the questions
// are one model call (flashcards/questions.ts) — and it names a GenerationRun rather
// than a Story or a Brief because the run *is* the frozen evidence: Story detail and
// Brief detail both hand a reader the same run id, so one field serves both surfaces.
//
// Repeating it is safe and cheap: cards already made are left as they are, with the
// schedule they have been reviewed against.
flashcardsRouter.post(
  "/flashcards",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (body.studyDetail !== undefined && typeof body.studyDetail !== "string") {
      res.status(422).json({ error: "studyDetail must be text" });
      return;
    }
    const studyDetail = body.studyDetail?.trim() || undefined;
    if (studyDetail && studyDetail.length > MAX_STUDY_DETAIL_LENGTH) {
      res.status(422).json({ error: `studyDetail must be at most ${MAX_STUDY_DETAIL_LENGTH} characters` });
      return;
    }
    const reader = await loadReaderRun(body.generationRunId, req.user!.role);
    if (!reader.ok) {
      res.status(422).json({ error: reader.error });
      return;
    }
    const cards = await generateDeck(createSynthesisProvider(), req.user!.id, reader.run.id, studyDetail);
    // An analysis whose every claim is somehow uncited would produce nothing. Nothing
    // can write one — validation refuses an uncited claim below the prompt — so this
    // is the honest answer rather than an error: there is no deck here to study.
    res.status(201).json({
      generationRunId: reader.run.id,
      storyId: reader.run.storyId,
      storyTitle: reader.run.story.title,
      cards,
    });
  }),
);

// The study session: what is due now, with both counts so the surface can tell "you
// have no cards" from "you are finished for today".
flashcardsRouter.get(
  "/flashcards",
  asyncHandler(async (req, res) => {
    res.json(await loadStudyDeck(req.user!.id));
  }),
);

// Recording an outcome, which is what reschedules the card (SM-2, flashcards/sm2.ts).
// A POST to a sub-collection rather than a PATCH on the card: a review is an event
// that happened, and the new schedule is its consequence — not a field a client gets
// to set. Which is also why `dueAt` is not writable anywhere.
flashcardsRouter.post(
  "/flashcards/:id/reviews",
  asyncHandler(async (req, res) => {
    const grade = (req.body ?? {}).grade;
    if (!isReviewGrade(grade)) {
      res.status(422).json({ error: `grade must be an integer from ${MIN_REVIEW_GRADE} to ${MAX_REVIEW_GRADE}` });
      return;
    }
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Flashcard not found" });
      return;
    }
    // Another Student's card is 404, not 403: a card is private study state, and
    // telling a stranger that one exists is telling them something about somebody
    // else's account. A Brief is 403 because its id is shareable by design — its
    // owner can name it in conversation — and a card's is not.
    const card = await reviewCard(req.user!.id, req.params.id, grade);
    if (!card) {
      res.status(404).json({ error: "Flashcard not found" });
      return;
    }
    res.json(card);
  }),
);
