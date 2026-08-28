import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSearchVectors1755744000000 implements MigrationInterface {
  name = "AddSearchVectors1755744000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Generated + STORED: Postgres keeps both in sync on every insert/update, so
    // neither is mapped on its entity (same reasoning as Article.embedding) and
    // the seed script needs no extra write. Two columns, not one cross-table
    // vector, because a generated column can only read its own row — hybrid
    // search's lexical CTE ORs the two (ADR-0014: lexical over "Article/Story text").
    await queryRunner.query(`
      ALTER TABLE "articles" ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', "title"), 'A') ||
          setweight(to_tsvector('english', "analysisText"), 'B')
        ) STORED
    `);
    await queryRunner.query(`CREATE INDEX "IDX_articles_searchVector" ON "articles" USING GIN ("searchVector")`);

    await queryRunner.query(`
      ALTER TABLE "stories" ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', "title"), 'A') ||
          setweight(to_tsvector('english', coalesce("summary", '')), 'B')
        ) STORED
    `);
    await queryRunner.query(`CREATE INDEX "IDX_stories_searchVector" ON "stories" USING GIN ("searchVector")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_stories_searchVector"`);
    await queryRunner.query(`ALTER TABLE "stories" DROP COLUMN "searchVector"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_searchVector"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "searchVector"`);
  }
}
