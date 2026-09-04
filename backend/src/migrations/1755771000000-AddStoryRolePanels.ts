import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryRolePanels1755771000000 implements MigrationInterface {
  name = "AddStoryRolePanels1755771000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stories" ADD COLUMN "clusteringRunId" uuid REFERENCES "clustering_runs"("id") ON DELETE SET NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_stories_clusteringRunId" ON "stories" ("clusteringRunId")`);
    await queryRunner.query(`
      CREATE TABLE "story_merge_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "survivorStoryId" uuid NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
        "mergedStoryId" uuid NOT NULL,
        "mergedStory" jsonb NOT NULL,
        "articles" jsonb NOT NULL,
        "rejectedAssignments" jsonb NOT NULL,
        "evidenceSetIds" uuid[] NOT NULL DEFAULT '{}',
        "generationRunIds" uuid[] NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_story_merge_records_survivor" ON "story_merge_records" ("survivorStoryId", "createdAt" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_story_merge_records_survivor"`);
    await queryRunner.query(`DROP TABLE "story_merge_records"`);
    await queryRunner.query(`DROP INDEX "IDX_stories_clusteringRunId"`);
    await queryRunner.query(`ALTER TABLE "stories" DROP COLUMN "clusteringRunId"`);
  }
}
