import { MigrationInterface, QueryRunner } from "typeorm";

export class RegroundFlashcards1755768000000 implements MigrationInterface {
  name = "RegroundFlashcards1755768000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evidence_sets" ALTER COLUMN "storyId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "flashcards" ALTER COLUMN "generationRunId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "flashcards" ALTER COLUMN "claimId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "flashcards" ADD COLUMN "answer" text NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "flashcards" ADD COLUMN "evidenceSetId" uuid REFERENCES "evidence_sets" ("id") ON DELETE CASCADE`);
    await queryRunner.query(`UPDATE "flashcards" f SET "answer" = c."text" FROM "analysis_claims" c WHERE c."id" = f."claimId"`);
    await queryRunner.query(`UPDATE "flashcards" f SET "evidenceSetId" = r."evidenceSetId" FROM "generation_runs" r WHERE r."id" = f."generationRunId"`);
    await queryRunner.query(`
      CREATE TABLE "flashcard_citations" (
        "flashcardId" uuid NOT NULL REFERENCES "flashcards" ("id") ON DELETE CASCADE,
        "evidenceId" varchar NOT NULL,
        "articleId" uuid NOT NULL REFERENCES "articles" ("id") ON DELETE CASCADE,
        PRIMARY KEY ("flashcardId", "evidenceId")
      )
    `);
    await queryRunner.query(`CREATE TABLE "flashcard_generation_cache" ("contentHash" varchar PRIMARY KEY, "response" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await queryRunner.query(`
      INSERT INTO "flashcard_citations" ("flashcardId", "evidenceId", "articleId")
      SELECT f."id", ce."evidenceId", ce."articleId"
      FROM "flashcards" f JOIN "claim_evidence" ce ON ce."claimId" = f."claimId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "flashcard_generation_cache"`);
    await queryRunner.query(`DELETE FROM "flashcards" WHERE "generationRunId" IS NULL OR "claimId" IS NULL`);
    await queryRunner.query(`DELETE FROM "evidence_sets" WHERE "storyId" IS NULL`);
    await queryRunner.query(`DROP TABLE "flashcard_citations"`);
    await queryRunner.query(`ALTER TABLE "flashcards" DROP COLUMN "evidenceSetId"`);
    await queryRunner.query(`ALTER TABLE "flashcards" DROP COLUMN "answer"`);
    await queryRunner.query(`ALTER TABLE "flashcards" ALTER COLUMN "generationRunId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "flashcards" ALTER COLUMN "claimId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "evidence_sets" ALTER COLUMN "storyId" SET NOT NULL`);
  }
}
