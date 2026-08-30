import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPublisherTermsClass1755748000000 implements MigrationInterface {
  name = "AddPublisherTermsClass1755748000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #40: rights enforcement stops being an Analysis Text Mode approximation.
    // Existing rows take the fail-closed default rather than a guess at what
    // they were cleared for; `npm run seed` converges the fixture Publishers,
    // whose text is our own, back to `licensed`.
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN "termsClass" varchar NOT NULL DEFAULT 'internal_only'`,
    );
    await queryRunner.query(`
      ALTER TABLE "publishers" ADD CONSTRAINT "publishers_termsClass_check"
        CHECK ("termsClass" IN ('open_metadata', 'syndicated_excerpt', 'internal_only', 'licensed'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "publishers_termsClass_check"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "termsClass"`);
  }
}
