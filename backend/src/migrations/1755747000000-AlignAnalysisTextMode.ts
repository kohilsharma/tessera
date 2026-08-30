import { MigrationInterface, QueryRunner } from "typeorm";

export class AlignAnalysisTextMode1755747000000 implements MigrationInterface {
  name = "AlignAnalysisTextMode1755747000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0024: metadata-only Articles carry no pretend body. The generated
    // vector must coalesce nullable text or Postgres would make the whole vector
    // NULL and silently drop these Articles from lexical search.
    await queryRunner.query(`DROP INDEX "IDX_articles_searchVector"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "searchVector"`);
    await queryRunner.query(`ALTER TABLE "articles" ALTER COLUMN "analysisText" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "articles_analysisTextMode_check"`);
    await queryRunner.query(`
      ALTER TABLE "articles" ADD CONSTRAINT "articles_analysisTextMode_check"
        CHECK ("analysisTextMode" IN
          ('metadata_only', 'feed_excerpt', 'api_content', 'licensed_full_text', 'manual_fixture'))
    `);
    await queryRunner.query(`
      ALTER TABLE "articles" ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', "title"), 'A') ||
          setweight(to_tsvector('english', coalesce("analysisText", '')), 'B')
        ) STORED
    `);
    await queryRunner.query(`CREATE INDEX "IDX_articles_searchVector" ON "articles" USING GIN ("searchVector")`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      "AlignAnalysisTextMode is irreversible: the previous schema cannot represent metadata-only Articles without data loss",
    );
  }
}
