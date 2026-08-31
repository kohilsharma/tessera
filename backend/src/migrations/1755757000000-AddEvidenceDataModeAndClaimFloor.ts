import { MigrationInterface, QueryRunner } from "typeorm";

const FAILURE_CODES = [
  "provider_error",
  "unparseable_output",
  "schema_violation",
  "invalid_citations",
  "below_claim_floor",
  "content_changed",
];

// The check written inline by CreateGenerationRuns has a generated name, so it is
// found by what it constrains rather than by a name nothing recorded. The replacement
// is named, so the next value added to the vocabulary is a two-line migration.
async function dropFailureCodeCheck(queryRunner: QueryRunner): Promise<void> {
  const existing: { conname: string }[] = await queryRunner.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = '"generation_runs"'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%unparseable_output%'`,
  );
  for (const { conname } of existing) {
    await queryRunner.query(`ALTER TABLE "generation_runs" DROP CONSTRAINT "${conname}"`);
  }
}

export class AddEvidenceDataModeAndClaimFloor1755757000000 implements MigrationInterface {
  name = "AddEvidenceDataModeAndClaimFloor1755757000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0027: the weakest rung among a set's members, recorded on the set. Left null
    // on sets frozen before #54 rather than derived from Articles that have moved up the
    // ladder since — a rung invented after the fact would describe today's corpus, not
    // what that analysis read.
    await queryRunner.query(`
      ALTER TABLE "evidence_sets"
        ADD "dataMode" varchar,
        ADD CONSTRAINT "CHK_evidence_sets_data_mode" CHECK ("dataMode" IN
          ('metadata_only', 'feed_excerpt', 'api_content', 'licensed_full_text', 'manual_fixture'))
    `);

    // #54 adds one failure code: partial acceptance means an invalid claim is dropped
    // rather than fatal, so what fails a run is the floor beneath the survivors.
    await dropFailureCodeCheck(queryRunner);
    await queryRunner.query(
      `ALTER TABLE "generation_runs" ADD CONSTRAINT "CHK_generation_runs_failure_code"
         CHECK ("failureCode" IN (${FAILURE_CODES.map((code) => `'${code}'`).join(", ")}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "generation_runs" DROP CONSTRAINT "CHK_generation_runs_failure_code"`);
    // Rows recording the floor failure would fail the narrower check, and a failed run
    // has to say why: they become the closest thing the old vocabulary could state.
    await queryRunner.query(
      `UPDATE "generation_runs" SET "failureCode" = 'invalid_citations' WHERE "failureCode" = 'below_claim_floor'`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_runs" ADD CONSTRAINT "CHK_generation_runs_failure_code"
         CHECK ("failureCode" IN (${FAILURE_CODES.filter((code) => code !== "below_claim_floor")
           .map((code) => `'${code}'`)
           .join(", ")}))`,
    );
    await queryRunner.query(`ALTER TABLE "evidence_sets" DROP CONSTRAINT "CHK_evidence_sets_data_mode"`);
    await queryRunner.query(`ALTER TABLE "evidence_sets" DROP COLUMN "dataMode"`);
  }
}
