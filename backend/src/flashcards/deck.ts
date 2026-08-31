import { AppDataSource } from "../data-source";
import type { ClaimType } from "../entities/AnalysisClaim";
import { Flashcard } from "../entities/Flashcard";
import type { SynthesisProvider } from "../synthesis";
import { dueAfter, reschedule } from "./sm2";
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
async function citationsFor(claimIds: string[]): Promise<Map<string, CardCitation[]>> {
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
      ORDER BY esa."sourceRank" ASC`,
    [claimIds],
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

async function withCitations(rows: CardRow[]): Promise<FlashcardView[]> {
  const citations = await citationsFor(rows.map((row) => row.claimId));
  return rows
    .map(({ claimId, ...card }) => ({ ...card, citations: citations.get(claimId) ?? [] }))
    .filter((card) => card.citations.length > 0);
}

export type StudyDeck = {
  items: FlashcardView[];
  // Both counts, because the two empty states are different facts: a Student with no
  // cards has a deck to make, and a Student with nothing due is finished for now —
  // and the surface can only say which if it is told both.
  dueCount: number;
  totalCount: number;
  // When the soonest card not yet due comes back, so "nothing due" can say when.
  nextDueAt: Date | null;
};

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
  const [counts]: { dueCount: number; totalCount: number; nextDueAt: Date | null }[] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS "totalCount",
            (COUNT(*) FILTER (WHERE "dueAt" <= now()))::int AS "dueCount",
            MIN("dueAt") FILTER (WHERE "dueAt" > now()) AS "nextDueAt"
       FROM "flashcards" WHERE "ownerId" = $1`,
    [ownerId],
  );
  return { items: await withCitations(rows), ...counts };
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
  return withCitations(rows);
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
    const questions = await writeQuestions(provider, claims);
    await AppDataSource.createQueryBuilder()
      .insert()
      .into(Flashcard)
      .values(
        claims.map((claim, index) => ({
          ownerId,
          generationRunId,
          claimId: claim.id,
          question: questions[index],
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
  grade: number,
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
        dueAfter(reviewedAt, next.intervalDays),
        reviewedAt,
      ],
    );
    return true;
  });
  if (!reviewed) return null;

  const rows: CardRow[] = await AppDataSource.query(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE f."id" = $1`,
    [cardId],
  );
  // The same reader every other path uses, so a reviewed card comes back in the shape
  // the surface already renders — including its citations, which is what makes it
  // still readable after the answer has been revealed.
  return (await withCitations(rows))[0] ?? null;
}
