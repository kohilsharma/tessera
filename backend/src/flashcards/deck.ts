import { createHash } from "node:crypto";
import { AppDataSource } from "../data-source";
import type { ClaimType } from "../entities/AnalysisClaim";
import { Flashcard } from "../entities/Flashcard";
import type { SynthesisProvider } from "../synthesis";
import { dueAfter, reschedule, type ReviewGrade } from "./sm2";
import { writeQuestions } from "./questions";

// The Student half of ADR-0021, over machinery that already exists: a card is a
// question in front of a validated AnalysisClaim, so generating a deck writes
// questions and inserts rows — there is no second pipeline, no second prompt
// contract, and no second citation check. The rows a card cites are read back
// through the same frozen EvidenceSet the analysis was written from.

// How many due cards one study session serves. A deck grows by a handful of cards
// per analysis a Student keeps, so this is a session length rather than a page size:
// a screen of 200 questions is not a revision session.
export const STUDY_SESSION_LIMIT = 20;

export type CardCitation = {
  evidenceId: string;
  articleId: string;
  title: string;
  publisherName: string;
};

export type FlashcardView = {
  id: string;
  question: string;
  // The claim itself: the answer, and the type of claim it is, so the surface can say
  // what kind of thing is being recalled.
  answer: string;
  claimType: ClaimType;
  citations: CardCitation[];
  storyId: string;
  storyTitle: string;
  generationRunId: string;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
};

type CardRow = Omit<FlashcardView, "citations"> & { claimId: string };

// Two queries and a group, rather than one query and a de-duplicate: a card has up to
// ten citations, so joining them onto the card row would multiply the deck by its
// citations and hand the caller rows to fold.
//
// The citation join is the invariant holding at the last point before a reader sees
// anything, exactly as loadGenerationView's is: an evidence id that does not resolve
// into its run's own frozen set is not rendered, and a card left with no citation is
// not served at all. Validation makes that impossible upstream, which is precisely
// why it is worth being structurally impossible here too.
async function citationsFor(ownerId: string, claimIds: string[]): Promise<Map<string, CardCitation[]>> {
  const byClaim = new Map<string, CardCitation[]>();
  if (claimIds.length === 0) return byClaim;
  const rows: (CardCitation & { claimId: string })[] = await AppDataSource.query(
    `SELECT ce."claimId", ce."evidenceId", ce."articleId",
            esa."titleSnapshot" AS "title", esa."publisherNameSnapshot" AS "publisherName"
       FROM "claim_evidence" ce
       JOIN "analysis_claims" c ON c."id" = ce."claimId"
       JOIN "generation_runs" r ON r."id" = c."generationRunId"
       JOIN "evidence_set_articles" esa
         ON esa."evidenceSetId" = r."evidenceSetId" AND esa."evidenceId" = ce."evidenceId"
      WHERE ce."claimId" = ANY($1)
        AND EXISTS (
          SELECT 1 FROM "flashcards" owned
           WHERE owned."claimId" = ce."claimId" AND owned."ownerId" = $2
        )
      ORDER BY esa."sourceRank" ASC`,
    [claimIds, ownerId],
  );
  for (const { claimId, ...citation } of rows) {
    byClaim.set(claimId, [...(byClaim.get(claimId) ?? []), citation]);
  }
  return byClaim;
}

const CARD_COLUMNS = `f."id", f."question", f."claimId", f."repetitions", f."easeFactor",
        f."intervalDays", f."dueAt", f."lastReviewedAt", f."generationRunId",
        c."claimType", c."text" AS "answer", r."storyId", s."title" AS "storyTitle"`;

const CARD_JOINS = `FROM "flashcards" f
       JOIN "analysis_claims" c ON c."id" = f."claimId"
       JOIN "generation_runs" r ON r."id" = f."generationRunId"
       JOIN "stories" s ON s."id" = r."storyId"`;

async function withCitations(ownerId: string, rows: CardRow[]): Promise<FlashcardView[]> {
  const citations = await citationsFor(ownerId, rows.map((row) => row.claimId));
  return rows
    .map(({ claimId, ...card }) => ({ ...card, citations: citations.get(claimId) ?? [] }))
    .filter((card) => card.citations.length > 0);
}

export type StudySummary = {
  // Both counts, because the two empty states are different facts: a Student with no
  // cards has a deck to make, and a Student with nothing due is finished for now.
  dueCount: number;
  totalCount: number;
  // When the soonest card not yet due comes back, so "nothing due" can say when.
  nextDueAt: Date | null;
};

export type StudyDeck = StudySummary & {
  items: FlashcardView[];
};

export async function loadStudySummary(ownerId: string): Promise<StudySummary> {
  const [summary]: StudySummary[] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS "totalCount",
            (COUNT(*) FILTER (WHERE "dueAt" <= now()))::int AS "dueCount",
            MIN("dueAt") FILTER (WHERE "dueAt" > now()) AS "nextDueAt"
       FROM "flashcards" WHERE "ownerId" = $1`,
    [ownerId],
  );
  return summary;
}

// What a study session is: this owner's due cards, soonest first. Ordered by id after
// dueAt so a session is stable across a reload rather than reshuffled by whatever
// order Postgres returns ties in.
export async function loadStudyDeck(ownerId: string): Promise<StudyDeck> {
  const rows: CardRow[] = await AppDataSource.query(
    `SELECT ${CARD_COLUMNS}
       ${CARD_JOINS}
      WHERE f."ownerId" = $1 AND f."dueAt" <= now()
      ORDER BY f."dueAt" ASC, f."id" ASC
      LIMIT ${STUDY_SESSION_LIMIT}`,
    [ownerId],
  );
  const summary = await loadStudySummary(ownerId);
  return { items: await withCitations(ownerId, rows), ...summary };
}

// A deck for one analysis, whatever its cards' schedules: what a Student is shown
// straight after generating, and how they read back a deck they made earlier.
export async function loadRunDeck(ownerId: string, generationRunId: string): Promise<FlashcardView[]> {
  const rows: CardRow[] = await AppDataSource.query(
    `SELECT ${CARD_COLUMNS}
       ${CARD_JOINS}
      WHERE f."ownerId" = $1 AND f."generationRunId" = $2
      ORDER BY c."displayOrder" ASC`,
    [ownerId, generationRunId],
  );
  return withCitations(ownerId, rows);
}

// Questions are a model-derived view of immutable claim text plus the optional
// Student focus. Cache the bytes that decide the question so shared analyses reuse
// synthesis only when they are being studied from the same angle.
function questionContentHash(claim: { claimType: ClaimType; text: string }, studyDetail?: string): string {
  return createHash("sha256")
    .update(claim.claimType)
    .update("\0")
    .update(claim.text)
    .update("\0")
    .update(studyDetail ?? "")
    .digest("hex");
}

async function cachedQuestions(hashes: string[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows: { contentHash: string; question: string }[] = await AppDataSource.query(
    `SELECT "contentHash", "question" FROM "flashcard_question_cache" WHERE "contentHash" = ANY($1)`,
    [hashes],
  );
  return new Map(rows.map((row) => [row.contentHash, row.question]));
}

// Generating a deck. Idempotent by the unique index on (ownerId, claimId): asking
// again is how a Student returns to a Story they are studying, so it adds the claims
// that are new — an analysis regenerated under a tuned prompt is a different run, and
// its claims are different rows — and leaves every existing card, with the review
// history behind it, alone.
//
// Only claims that actually carry a citation get a card, which is ADR-0021's
// guardrail as a WHERE clause. Validation cannot persist an uncited claim, so this
// filters nothing today; it is here because "no card whose answer isn't grounded" is
// a property worth being unable to violate rather than one held up by a promise made
// elsewhere.
export async function generateDeck(
  provider: SynthesisProvider,
  ownerId: string,
  generationRunId: string,
  studyDetail?: string,
): Promise<FlashcardView[]> {
  const claims: { id: string; claimType: ClaimType; text: string }[] = await AppDataSource.query(
    `SELECT c."id", c."claimType", c."text"
       FROM "analysis_claims" c
      WHERE c."generationRunId" = $1
        AND EXISTS (SELECT 1 FROM "claim_evidence" ce WHERE ce."claimId" = c."id")
        AND NOT EXISTS (SELECT 1 FROM "flashcards" f WHERE f."claimId" = c."id" AND f."ownerId" = $2)
      ORDER BY c."displayOrder" ASC`,
    [generationRunId, ownerId],
  );

  if (claims.length > 0) {
    const hashes = claims.map((claim) => questionContentHash(claim, studyDetail));
    let questionsByHash = await cachedQuestions(hashes);
    const misses = claims.filter((_claim, index) => !questionsByHash.has(hashes[index]));
    if (misses.length > 0) {
      const written = await writeQuestions(provider, misses, studyDetail);
      const missHashes = misses.map((claim) => questionContentHash(claim, studyDetail));
      await AppDataSource.query(
        `INSERT INTO "flashcard_question_cache" ("contentHash", "question")
         SELECT * FROM unnest($1::varchar[], $2::text[])
         ON CONFLICT ("contentHash") DO NOTHING`,
        [missHashes, written],
      );
      // Re-read after the conflict-safe insert: if another request won the same hash,
      // every Student still receives the one question the cache chose.
      questionsByHash = await cachedQuestions(hashes);
    }

    await AppDataSource.createQueryBuilder()
      .insert()
      .into(Flashcard)
      .values(
        claims.map((claim, index) => ({
          ownerId,
          generationRunId,
          claimId: claim.id,
          question: questionsByHash.get(hashes[index])!,
          dueAt: new Date(),
        })),
      )
      // The index decides, not the read above: two requests racing for one deck would
      // both see no cards, and the second insert is a no-op rather than a 500.
      .orIgnore()
      .execute();
  }

  return loadRunDeck(ownerId, generationRunId);
}

// Recording a review. Null means there was no such card for this owner — a wrong id,
// or somebody else's card, and the route answers those the same way it answers a
// Brief that is not yours.
export async function reviewCard(
  ownerId: string,
  cardId: string,
  grade: ReviewGrade,
): Promise<FlashcardView | null> {
  const reviewedAt = new Date();
  // Locked and re-read rather than computed from what the client sent: a schedule is
  // advanced from where it actually stands, so two reviews landing together apply in
  // some order instead of both advancing the same starting state.
  const reviewed = await AppDataSource.transaction(async (manager) => {
    const [card]: { repetitions: number; easeFactor: number; intervalDays: number }[] = await manager.query(
      `SELECT "repetitions", "easeFactor", "intervalDays" FROM "flashcards"
        WHERE "id" = $1 AND "ownerId" = $2 FOR UPDATE`,
      [cardId, ownerId],
    );
    if (!card) return false;
    const next = reschedule(card, grade);
    const dueAt = dueAfter(reviewedAt, next.intervalDays);
    await manager.query(
      `UPDATE "flashcards"
          SET "repetitions" = $3, "easeFactor" = $4, "intervalDays" = $5, "dueAt" = $6, "lastReviewedAt" = $7
        WHERE "id" = $1 AND "ownerId" = $2`,
      [
        cardId,
        ownerId,
        next.repetitions,
        next.easeFactor,
        next.intervalDays,
        dueAt,
        reviewedAt,
      ],
    );
    // The submitted outcome and the schedule it produced are one transaction. The
    // card keeps only its current schedule; this row is the durable review history
    // behind it, so a later review cannot erase what the Student recorded today.
    await manager.query(
      `INSERT INTO "flashcard_reviews"
         ("flashcardId", "ownerId", "grade", "repetitions", "easeFactor", "intervalDays", "dueAt", "reviewedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [cardId, ownerId, grade, next.repetitions, next.easeFactor, next.intervalDays, dueAt, reviewedAt],
    );
    return true;
  });
  if (!reviewed) return null;

  const rows: CardRow[] = await AppDataSource.query(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE f."id" = $1 AND f."ownerId" = $2`,
    [cardId, ownerId],
  );
  // The same reader every other path uses, so a reviewed card comes back in the shape
  // the surface already renders — including its citations, which is what makes it
  // still readable after the answer has been revealed.
  return (await withCitations(ownerId, rows))[0] ?? null;
}
