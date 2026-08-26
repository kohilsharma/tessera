import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBriefs1755743000000 implements MigrationInterface {
  name = "CreateBriefs1755743000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "intelligence_briefs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar NOT NULL CHECK (char_length(trim("title")) > 0),
        "note" text,
        "category" varchar NOT NULL CHECK ("category" IN
          ('politics', 'business', 'technology', 'science', 'health', 'world', 'sports', 'entertainment')),
        "articleCapacityLimit" int NOT NULL DEFAULT 20 CHECK ("articleCapacityLimit" > 0),
        "coverImageKey" varchar,
        "ownerId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_intelligence_briefs_ownerId" ON "intelligence_briefs" ("ownerId")`);

    await queryRunner.query(`
      CREATE TABLE "brief_articles" (
        "briefId" uuid NOT NULL REFERENCES "intelligence_briefs"("id") ON DELETE CASCADE,
        "articleId" uuid NOT NULL REFERENCES "articles"("id") ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("briefId", "articleId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "brief_articles"`);
    await queryRunner.query(`DROP TABLE "intelligence_briefs"`);
  }
}
