import { MigrationInterface, QueryRunner } from "typeorm";

// Follow-up to #58's first migration. Reviews are events, not just the current
// schedule: the submitted grade and the schedule it produced must remain recoverable
// after the card is reviewed again. Questions are shared derivations of immutable
// claim text, so their model call is cached by that content rather than paid once per
// Student (AGENTS.md's content-hash invariant).
export class RecordFlashcardReviewsAndCacheQuestions1755762000000 implements MigrationInterface {
  name = "RecordFlashcardReviewsAndCacheQuestions1755762000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "flashcard_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "flashcardId" uuid NOT NULL REFERENCES "flashcards" ("id") ON DELETE CASCADE,
        "ownerId" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "grade" smallint NOT NULL,
        "repetitions" integer NOT NULL,
        "easeFactor" double precision NOT NULL,
        "intervalDays" integer NOT NULL,
        "dueAt" timestamptz NOT NULL,
        "reviewedAt" timestamptz NOT NULL,
        CONSTRAINT "CHK_flashcard_reviews_grade" CHECK ("grade" BETWEEN 0 AND 5),
        CONSTRAINT "CHK_flashcard_reviews_schedule" CHECK (
          "repetitions" >= 0 AND "easeFactor" >= 1.3 AND "intervalDays" >= 0
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_flashcard_reviews_owner_card" ON "flashcard_reviews" ("ownerId", "flashcardId", "reviewedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "flashcard_question_cache" (
        "contentHash" varchar PRIMARY KEY,
        "question" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "flashcard_question_cache"`);
    await queryRunner.query(`DROP TABLE "flashcard_reviews"`);
  }
}
