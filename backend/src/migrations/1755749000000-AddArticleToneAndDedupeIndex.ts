import { MigrationInterface, QueryRunner } from "typeorm";

export class AddArticleToneAndDedupeIndex1755749000000 implements MigrationInterface {
  name = "AddArticleToneAndDedupeIndex1755749000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GKG field 16's average tone, kept for the Phase-3.5 timeline overlay
    // (ADR-0020, ADR-0024). Nullable and unindexed: only the GKG connector writes
    // it and nothing reads it yet, so an index would be speculation.
    await queryRunner.query(`ALTER TABLE "articles" ADD COLUMN "tone" double precision`);

    // Duplicate matching reads one publisher's Articles for one calendar day
    // (CONTEXT.md "Duplicate"). Ten curated feeds made that a handful of rows on
    // the publishedAt index alone; the GKG firehose is ~650 rows every 15 minutes
    // across ~160 domains, so the day range is now tens of thousands of rows and
    // the scan needs the publisher in the index rather than in a filter.
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_publisher_publishedAt" ON "articles" ("publisherId", "publishedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_articles_publisher_publishedAt"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "tone"`);
  }
}
