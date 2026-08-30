import { MigrationInterface, QueryRunner } from "typeorm";

export class PreserveGkgAnnotationSurfaceNames1755751000000 implements MigrationInterface {
  name = "PreserveGkgAnnotationSurfaceNames1755751000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_gkg_annotations_occurrence"`);
    await queryRunner.query(`ALTER TABLE "gkg_annotations" ALTER COLUMN "surfaceName" TYPE text`);
    // Keep the index key fixed-size while preserving the exact, untrusted name.
    // ponytail: MD5 is only an idempotency key; use an app-populated SHA-256
    // column if adversarial collision resistance becomes an ingestion requirement.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gkg_annotations_occurrence"
        ON "gkg_annotations" ("articleId", "kind", "charOffset", md5("surfaceName"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_gkg_annotations_occurrence"`);
    // PostgreSQL refuses this conversion if long names exist, preventing rollback
    // from silently truncating staged evidence.
    await queryRunner.query(`ALTER TABLE "gkg_annotations" ALTER COLUMN "surfaceName" TYPE varchar(512)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gkg_annotations_occurrence"
        ON "gkg_annotations" ("articleId", "kind", "surfaceName", "charOffset")
    `);
  }
}
