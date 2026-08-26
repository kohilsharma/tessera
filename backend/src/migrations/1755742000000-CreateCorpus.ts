import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCorpus1755742000000 implements MigrationInterface {
  name = "CreateCorpus1755742000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "publishers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "domain" varchar NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "stories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slug" varchar NOT NULL UNIQUE,
        "title" varchar NOT NULL,
        "summary" text,
        "category" varchar NOT NULL CHECK ("category" IN
          ('politics', 'business', 'technology', 'science', 'health', 'world', 'sports', 'entertainment')),
        "firstSeenAt" timestamptz NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_stories_category" ON "stories" ("category")`);
    await queryRunner.query(`CREATE INDEX "IDX_stories_firstSeenAt" ON "stories" ("firstSeenAt")`);

    await queryRunner.query(`
      CREATE TABLE "articles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
        "publisherId" uuid NOT NULL REFERENCES "publishers"("id"),
        "title" varchar NOT NULL,
        "url" varchar NOT NULL UNIQUE,
        "analysisText" text NOT NULL,
        "analysisTextType" varchar NOT NULL CHECK ("analysisTextType" IN
          ('feed_excerpt', 'api_content', 'licensed_full_text', 'manual_fixture')),
        "publishedAt" timestamptz NOT NULL,
        "embedding" vector(1024),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_articles_storyId" ON "articles" ("storyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_articles_publishedAt" ON "articles" ("publishedAt")`);
    // ADR-0017: HNSW cosine index for nearest-neighbour search over the embedding column.
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_embedding_hnsw" ON "articles" USING hnsw ("embedding" vector_cosine_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "articles"`);
    await queryRunner.query(`DROP TABLE "stories"`);
    await queryRunner.query(`DROP TABLE "publishers"`);
  }
}
