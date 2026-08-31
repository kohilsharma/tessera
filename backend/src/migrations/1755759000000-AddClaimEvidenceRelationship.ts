import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClaimEvidenceRelationship1755759000000 implements MigrationInterface {
  name = "AddClaimEvidenceRelationship1755759000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing generations did not record polarity, so NULL means unknown rather
    // than rewriting every old citation as support. New generation persists one of
    // these two values for every citation.
    await queryRunner.query(`
      ALTER TABLE "claim_evidence"
        ADD COLUMN "relationship" varchar
        CHECK ("relationship" IN ('supports', 'contradicts'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "claim_evidence" DROP COLUMN "relationship"`);
  }
}
