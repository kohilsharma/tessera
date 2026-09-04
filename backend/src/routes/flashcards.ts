import { Router } from "express";
import { editCard, deleteCard, generateDeck, loadAllCards, loadCard, loadCardHistory, loadStudyDeck, reviewCard, type CardListStatus } from "../flashcards/deck";
import { ANSWER_LENGTHS, CARD_COUNTS, generateSearchDeck, type AnswerLength } from "../flashcards/search";
import { isReviewGrade, MAX_REVIEW_GRADE, MIN_REVIEW_GRADE } from "../flashcards/sm2";
import { loadReaderRun } from "../generation/readerRun";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { createSynthesisProvider } from "../synthesis";
import { isUuid } from "../lib/uuid";
import { parseListQuery } from "../lib/listQuery";

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
    const reader = await loadReaderRun((req.body ?? {}).generationRunId, req.user!.role);
    if (!reader.ok) {
      res.status(422).json({ error: reader.error });
      return;
    }
    const cards = await generateDeck(createSynthesisProvider(), req.user!.id, reader.run.id);
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

flashcardsRouter.post(
  "/flashcards/search",
  asyncHandler(async (req, res) => {
    const { q, count = 5, answerLength = "full" } = req.body ?? {};
    if (typeof q !== "string" || !q.trim()) { res.status(422).json({ error: "q is required" }); return; }
    if (!CARD_COUNTS.includes(Number(count) as (typeof CARD_COUNTS)[number])) { res.status(422).json({ error: "count must be 5, 10, or 20" }); return; }
    if (!ANSWER_LENGTHS.includes(answerLength as AnswerLength)) { res.status(422).json({ error: "answerLength must be one_word, one_line, or full" }); return; }
    const ids = await generateSearchDeck(createSynthesisProvider(), req.user!.id, q.trim(), Number(count), answerLength as AnswerLength);
    const cards = (await Promise.all(ids.map((id) => loadCard(req.user!.id, id)))).filter(Boolean);
    res.status(201).json({ query: q.trim(), cards });
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

flashcardsRouter.get("/flashcards/all", asyncHandler(async (req, res) => {
  const parsed = parseListQuery(req.query as Record<string, unknown>, {
    allowedSortBy: ["createdAt", "dueAt"],
    defaultSortBy: "createdAt",
    maxPageSize: 50,
  });
  if (!parsed.ok) { res.status(422).json({ error: parsed.error }); return; }

  const rawStatus = req.query.status ?? req.query.filter ?? (req.query.due !== undefined
    ? (req.query.due === "true" || req.query.due === "1" ? "due" : "upcoming")
    : "all");
  const status = String(rawStatus) as CardListStatus;
  if (!["all", "due", "upcoming"].includes(status)) {
    res.status(422).json({ error: "status must be all, due, or upcoming" });
    return;
  }
  const rawQuery = req.query.q ?? req.query.search;
  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    res.status(422).json({ error: "q must be a string" });
    return;
  }
  const { page, pageSize, sortBy, sortDir } = parsed.value;
  res.json(await loadAllCards(req.user!.id, {
    page,
    pageSize,
    sortBy,
    sortDir,
    status,
    query: rawQuery,
  }));
}));

flashcardsRouter.get("/flashcards/:id", asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Flashcard not found" }); return; }
  const card = await loadCard(req.user!.id, req.params.id);
  if (!card) { res.status(404).json({ error: "Flashcard not found" }); return; }
  res.json(card);
}));

flashcardsRouter.patch("/flashcards/:id", asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Flashcard not found" }); return; }
  const body = req.body ?? {};
  const input: { question?: string; answer?: string } = {};
  for (const key of ["question", "answer"] as const) if (body[key] !== undefined) {
    if (typeof body[key] !== "string" || !body[key].trim()) { res.status(422).json({ error: `${key} must be a non-empty string` }); return; }
    input[key] = body[key].trim();
  }
  const card = await editCard(req.user!.id, req.params.id, input);
  if (!card) { res.status(404).json({ error: "Flashcard not found" }); return; }
  res.json(card);
}));

flashcardsRouter.delete("/flashcards/:id", asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id) || !(await deleteCard(req.user!.id, req.params.id))) { res.status(404).json({ error: "Flashcard not found" }); return; }
  res.status(204).end();
}));

flashcardsRouter.get("/flashcards/:id/history", asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Flashcard not found" }); return; }
  const history = await loadCardHistory(req.user!.id, req.params.id);
  if (!history) { res.status(404).json({ error: "Flashcard not found" }); return; }
  res.json({ items: history });
}));

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
