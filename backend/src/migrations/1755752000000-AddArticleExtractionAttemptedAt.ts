import { MigrationInterface, QueryRunner } from "typeorm";

export class AddArticleExtractionAttemptedAt1755752000000 implements MigrationInterface {
  name = "AddArticleExtractionAttemptedAt1755752000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #47. ADR-0018's fourth surface, and the reason the connector kinds are a
    // database CHECK as well as a TypeScript union: both have to be widened.
    await queryRunner.query(`ALTER TABLE "ingestion_connectors" DROP CONSTRAINT "ingestion_connectors_kind_check"`);
    await queryRunner.query(`
      ALTER TABLE "ingestion_connectors"
        ADD CONSTRAINT "ingestion_connectors_kind_check"
        CHECK ("kind" IN ('gdelt_gkg', 'gdelt_doc', 'rss', 'readability'))
    `);
    // Null on existing connectors: their feeds were not classified when those
    // rows were stored, and unknown provenance must not turn them into crawler
    // targets. The seed converges its curated RSS policies below this migration.
    await queryRunner.query(`ALTER TABLE "ingestion_connectors" ADD COLUMN "feedProvidesFullText" boolean`);
    // Null on every existing row: nothing has been attempted, which is the
    // truth, and the curated fixtures are excluded by connector kind anyway.
    await queryRunner.query(`ALTER TABLE "articles" ADD COLUMN "extractionAttemptedAt" timestamptz`);
    // The candidate query is exactly this predicate — unattempted and still on
    // the excerpt rung — and it runs every 15 minutes against a table the
    // firehose grows by hundreds of rows a window. The RSS connector's explicit
    // feed policy is joined separately.
    await queryRunner.query(`
      CREATE INDEX "IDX_articles_extraction_candidates"
        ON "articles" ("createdAt")
        WHERE "extractionAttemptedAt" IS NULL AND "analysisTextMode" = 'feed_excerpt'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_articles_extraction_candidates"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "extractionAttemptedAt"`);
    await queryRunner.query(`ALTER TABLE "ingestion_connectors" DROP COLUMN "feedProvidesFullText"`);
    await queryRunner.query(`ALTER TABLE "ingestion_connectors" DROP CONSTRAINT "ingestion_connectors_kind_check"`);
    // PostgreSQL refuses this constraint while an extraction connector exists,
    // which is the right answer: a rollback that silently deleted an operator's
    // connector rows to make room for itself would destroy configuration nobody
    // asked it to touch. Remove the connector by hand first.
    await queryRunner.query(`
      ALTER TABLE "ingestion_connectors"
        ADD CONSTRAINT "ingestion_connectors_kind_check"
        CHECK ("kind" IN ('gdelt_gkg', 'gdelt_doc', 'rss'))
    `);
  }
}
