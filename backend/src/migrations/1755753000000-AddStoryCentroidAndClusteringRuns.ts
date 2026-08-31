import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryCentroidAndClusteringRuns1755753000000 implements MigrationInterface {
  name = "AddStoryCentroidAndClusteringRuns1755753000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stories" ADD COLUMN "embedding" vector(1024)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stories_embedding_hnsw" ON "stories" USING hnsw ("embedding" vector_cosine_ops)`,
    );

    // ADR-0026 keeps membership on Article: the decision and score travel with
    // the storyId instead of requiring a join table for one-to-many membership.
    await queryRunner.query(`ALTER TABLE "articles" ADD COLUMN "storyAssignmentStatus" varchar`);
    await queryRunner.query(`ALTER TABLE "articles" ADD COLUMN "storyAssignmentScore" double precision`);
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "CHK_articles_story_assignment_status"
       CHECK ("storyAssignmentStatus" IS NULL OR "storyAssignmentStatus" IN ('auto_accepted', 'pending_review'))`,
    );
    // Existing curated membership predates clustering. The only current state is
    // accepted, and 1 records its fixture certainty without inventing a second status.
    await queryRunner.query(
      `UPDATE "articles" SET "storyAssignmentStatus" = 'auto_accepted', "storyAssignmentScore" = 1
       WHERE "storyId" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "clustering_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" varchar NOT NULL CHECK ("status" IN ('running', 'succeeded', 'failed')),
        "startedAt" timestamptz NOT NULL,
        "completedAt" timestamptz,
        "embedded" integer NOT NULL DEFAULT 0,
        "considered" integer NOT NULL DEFAULT 0,
        "assigned" integer NOT NULL DEFAULT 0,
        "seeded" integer NOT NULL DEFAULT 0,
        "unclustered" integer NOT NULL DEFAULT 0,
        "storiesCreated" integer NOT NULL DEFAULT 0,
        "errorSummary" text
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_clustering_runs_startedAt" ON "clustering_runs" ("startedAt" DESC)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_clustering_candidates" ON "articles" ("analysisTextMode", "storyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_articles_clustering_candidates"`);
    await queryRunner.query(`DROP TABLE "clustering_runs"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "CHK_articles_story_assignment_status"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "storyAssignmentScore"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "storyAssignmentStatus"`);
    await queryRunner.query(`DROP INDEX "IDX_stories_embedding_hnsw"`);
    await queryRunner.query(`ALTER TABLE "stories" DROP COLUMN "embedding"`);
  }
}
