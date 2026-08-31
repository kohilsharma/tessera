import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBriefGenerationRun1755758000000 implements MigrationInterface {
  name = "AddBriefGenerationRun1755758000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0027: "An IntelligenceBrief references a run through a nullable
    // generationRunId — which is what 'a Brief freezes a specific generation' means."
    // Nullable because a Brief assembled by hand freezes nothing, and that is the
    // Brief every Foundation ticket built.
    //
    // ON DELETE SET NULL rather than CASCADE: a reader's own artefact must not be
    // deleted because an analysis it saved went away. The Brief keeps its title, its
    // note and its pinned Articles either way — the claims are what it loses.
    await queryRunner.query(`
      ALTER TABLE "intelligence_briefs"
        ADD COLUMN "generationRunId" uuid REFERENCES "generation_runs" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "intelligence_briefs" DROP COLUMN "generationRunId"`);
  }
}
