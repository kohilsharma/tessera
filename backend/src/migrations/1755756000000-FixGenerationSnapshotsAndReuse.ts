import { MigrationInterface, QueryRunner } from "typeorm";

export class FixGenerationSnapshotsAndReuse1755756000000 implements MigrationInterface {
  name = "FixGenerationSnapshotsAndReuse1755756000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing rows predate provenance snapshots. Leave those fields null rather
    // than inventing history from today's mutable Article and Publisher values;
    // reuse excludes them, so the next request produces an honest fresh run.
    await queryRunner.query(`
      ALTER TABLE "evidence_set_articles"
        ADD "titleSnapshot" varchar,
        ADD "urlSnapshot" varchar,
        ADD "publishedAtSnapshot" timestamptz,
        ADD "analysisTextModeSnapshot" varchar,
        ADD "publisherIdSnapshot" uuid,
        ADD "publisherNameSnapshot" varchar,
        ADD "publisherDomainSnapshot" varchar,
        ADD CONSTRAINT "CHK_evidence_snapshot_all_or_none" CHECK (
          num_nonnulls(
            "titleSnapshot", "urlSnapshot", "publishedAtSnapshot", "analysisTextModeSnapshot",
            "publisherIdSnapshot", "publisherNameSnapshot", "publisherDomainSnapshot"
          ) IN (0, 7)
        )
    `);

    await queryRunner.query(`ALTER TABLE "generation_runs" ADD "model" varchar`);
    await queryRunner.query(`
      UPDATE "generation_runs"
         SET "model" = "provider",
             "provider" = CASE WHEN "provider" = 'mock' THEN 'mock' ELSE 'legacy:unknown' END
    `);
    await queryRunner.query(`ALTER TABLE "generation_runs" ALTER "model" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX "IDX_generation_runs_reuse"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_generation_runs_reuse"
         ON "generation_runs" ("storyId", "lens", "promptVersion", "provider", "model")
       WHERE "status" = 'completed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_generation_runs_reuse"`);
    await queryRunner.query(`UPDATE "generation_runs" SET "provider" = "model"`);
    await queryRunner.query(`ALTER TABLE "generation_runs" DROP COLUMN "model"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_generation_runs_reuse"
         ON "generation_runs" ("storyId", "lens", "promptVersion", "provider")
       WHERE "status" = 'completed'`,
    );
    await queryRunner.query(`
      ALTER TABLE "evidence_set_articles"
        DROP CONSTRAINT "CHK_evidence_snapshot_all_or_none",
        DROP COLUMN "publisherDomainSnapshot",
        DROP COLUMN "publisherNameSnapshot",
        DROP COLUMN "publisherIdSnapshot",
        DROP COLUMN "analysisTextModeSnapshot",
        DROP COLUMN "publishedAtSnapshot",
        DROP COLUMN "urlSnapshot",
        DROP COLUMN "titleSnapshot"
    `);
  }
}
