import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryCentroidAndClusteringRuns1755753000000 implements MigrationInterface {
  name = "AddStoryCentroidAndClusteringRuns1755753000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0026: a Story carries a centroid, recomputed from its members on every
    // run rather than maintained incrementally — a running mean drifts as members
    // are accepted, rejected and merged. Same 1024-dim space and same cosine
    // index as `articles.embedding` (ADR-0017), because assignment compares one
    // against the other.
    await queryRunner.query(`ALTER TABLE "stories" ADD COLUMN "embedding" vector(1024)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stories_embedding_hnsw" ON "stories" USING hnsw ("embedding" vector_cosine_ops)`,
    );

    // CONTEXT.md "Clustering Run". Counts only: what a run *did*, in the terms an
    // operator reads it in. No thresholds recorded per run — they are typed
    // constants in clustering/config.ts (ADR-0026: no SystemConfig table), and no
    // clustering version, because reclustering is not built and nothing would
    // write a second value.
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
    // The Admin console reads history newest first, and nothing reads it any
    // other way.
    await queryRunner.query(`CREATE INDEX "IDX_clustering_runs_startedAt" ON "clustering_runs" ("startedAt" DESC)`);

    // Every run's first query is "eligible, unclustered, no vector yet" and its
    // second is "eligible, unclustered, embedded". Both are a scan of `articles`
    // filtered on the same two columns, which on the firehose is mostly
    // `metadata_only` rows this job must never consider (ADR-0026).
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_clustering_candidates" ON "articles" ("analysisTextMode", "storyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_articles_clustering_candidates"`);
    await queryRunner.query(`DROP TABLE "clustering_runs"`);
    await queryRunner.query(`DROP INDEX "IDX_stories_embedding_hnsw"`);
    await queryRunner.query(`ALTER TABLE "stories" DROP COLUMN "embedding"`);
  }
}
