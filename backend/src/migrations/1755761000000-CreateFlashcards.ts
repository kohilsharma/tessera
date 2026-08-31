import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFlashcards1755761000000 implements MigrationInterface {
  name = "CreateFlashcards1755761000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0021's Student feature (#58). No answer column: the answer is the cited
    // AnalysisClaim this row points at, so a card cannot exist without the claim
    // whose citations ground it — which is the guardrail, expressed as a foreign key
    // rather than as a check somebody has to remember to run.
    //
    // Everything cascades on delete. A card is derived, owned study state: it is
    // worth nothing without its claim, its run, or its owner, and an orphan row
    // would be a question with no answer.
    await queryRunner.query(`
      CREATE TABLE "flashcards" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ownerId" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "generationRunId" uuid NOT NULL REFERENCES "generation_runs" ("id") ON DELETE CASCADE,
        "claimId" uuid NOT NULL REFERENCES "analysis_claims" ("id") ON DELETE CASCADE,
        "question" text NOT NULL,
        "repetitions" integer NOT NULL DEFAULT 0,
        "easeFactor" double precision NOT NULL DEFAULT 2.5,
        "intervalDays" integer NOT NULL DEFAULT 0,
        "dueAt" timestamptz NOT NULL DEFAULT now(),
        "lastReviewedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_flashcards_ease_factor" CHECK ("easeFactor" >= 1.3),
        CONSTRAINT "CHK_flashcards_interval" CHECK ("intervalDays" >= 0 AND "repetitions" >= 0)
      )
    `);

    // One card per claim per Student, decided by the database: asking for a deck
    // twice is how a Student returns to a Story they are studying, and a second deck
    // would either duplicate every question or — worse — reset the schedule they
    // have been reviewing against. Generation inserts ON CONFLICT DO NOTHING against
    // this index, so a repeat request adds the claims that are new and leaves the
    // rest, with their review history, alone.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_flashcards_owner_claim" ON "flashcards" ("ownerId", "claimId")`,
    );

    // The study surface's only query: this owner's cards, soonest due first.
    await queryRunner.query(`CREATE INDEX "IDX_flashcards_owner_due" ON "flashcards" ("ownerId", "dueAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "flashcards"`);
  }
}
