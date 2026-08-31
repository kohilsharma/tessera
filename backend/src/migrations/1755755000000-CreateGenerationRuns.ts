import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGenerationRuns1755755000000 implements MigrationInterface {
  name = "CreateGenerationRuns1755755000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The flagship's five tables (ADR-0010 keeps v3 §9.5–9.6's shape). Every CHECK
    // below mirrors a vocabulary exported from src/entities — the same arrangement
    // stories.category and articles.analysisTextMode already use, so an invented
    // value is a failed insert rather than a row nothing can render.

    // ON DELETE CASCADE on storyId: merging a Story (#52) deletes the emptied row,
    // and an analysis of a Story that no longer exists is not an analysis of
    // anything. The consequence to carry into #55 is that a Brief referencing a run
    // must survive its Story being merged away — by holding its own copy of what it
    // froze, not by holding this row.
    await queryRunner.query(`
      CREATE TABLE "evidence_sets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL REFERENCES "stories" ("id") ON DELETE CASCADE,
        "contentHash" varchar NOT NULL,
        "articleCount" integer NOT NULL,
        "distinctPublisherCount" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // The frozen rows. ON DELETE CASCADE on articleId would unfreeze a past set, so
    // it is worth stating why it is safe: the only thing that deletes an Article is
    // the Retention Window, which touches `metadata_only` rows that are unclustered
    // and uncited (src/ingestion/retention.ts) — and evidence is drawn from accepted
    // Story members with analysis text, which is neither.
    await queryRunner.query(`
      CREATE TABLE "evidence_set_articles" (
        "evidenceSetId" uuid NOT NULL REFERENCES "evidence_sets" ("id") ON DELETE CASCADE,
        "articleId" uuid NOT NULL REFERENCES "articles" ("id") ON DELETE CASCADE,
        "evidenceId" varchar NOT NULL,
        "articleContentHash" varchar NOT NULL,
        "sourceRank" integer NOT NULL,
        "selectionReason" varchar NOT NULL
          CHECK ("selectionReason" IN ('earliest_reporting', 'latest_reporting', 'centroid_rank')),
        "includedExcerptSnapshot" text NOT NULL,
        PRIMARY KEY ("evidenceSetId", "articleId"),
        -- A citation resolves an evidence id to exactly one Article, or it resolves
        -- to nothing that can be displayed.
        UNIQUE ("evidenceSetId", "evidenceId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "generation_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL REFERENCES "stories" ("id") ON DELETE CASCADE,
        "evidenceSetId" uuid NOT NULL REFERENCES "evidence_sets" ("id") ON DELETE CASCADE,
        "lens" varchar NOT NULL CHECK ("lens" IN ('student_context', 'investor_implication')),
        "promptVersion" varchar NOT NULL,
        "status" varchar NOT NULL CHECK ("status" IN ('completed', 'failed')),
        -- Not a CHECK-ed vocabulary: this is 'mock' or whichever model id the operator
        -- configured, and the point of ADR-0003 is that we never enumerate those.
        "provider" varchar NOT NULL,
        "triggeredByUserId" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "rawResponse" text,
        "validationResult" jsonb,
        "failureCode" varchar CHECK ("failureCode" IN (
          'provider_error', 'unparseable_output', 'schema_violation', 'invalid_citations', 'content_changed'
        )),
        "failureMessage" text,
        "startedAt" timestamptz NOT NULL,
        "completedAt" timestamptz NOT NULL,
        -- A completed run says nothing about why it failed, and a failed one has to.
        CHECK (("status" = 'failed') = ("failureCode" IS NOT NULL))
      )
    `);

    // ADR-0027's reuse key, as an index: one current run per Story, Lens,
    // prompt version and provider, found by joining the evidence hash. Partial, because a failed
    // run is never reused — asking again after a failure must reach the provider.
    await queryRunner.query(
      `CREATE INDEX "IDX_generation_runs_reuse"
         ON "generation_runs" ("storyId", "lens", "promptVersion", "provider")
       WHERE "status" = 'completed'`,
    );

    await queryRunner.query(`
      CREATE TABLE "analysis_claims" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "generationRunId" uuid NOT NULL REFERENCES "generation_runs" ("id") ON DELETE CASCADE,
        "claimType" varchar NOT NULL CHECK ("claimType" IN (
          'consensus', 'source_specific', 'contradiction', 'student_context', 'investor_implication'
        )),
        "text" text NOT NULL,
        "displayOrder" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_analysis_claims_run" ON "analysis_claims" ("generationRunId", "displayOrder")`,
    );

    await queryRunner.query(`
      CREATE TABLE "claim_evidence" (
        "claimId" uuid NOT NULL REFERENCES "analysis_claims" ("id") ON DELETE CASCADE,
        "evidenceId" varchar NOT NULL,
        "articleId" uuid NOT NULL REFERENCES "articles" ("id") ON DELETE CASCADE,
        PRIMARY KEY ("claimId", "evidenceId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "claim_evidence"`);
    await queryRunner.query(`DROP TABLE "analysis_claims"`);
    await queryRunner.query(`DROP TABLE "generation_runs"`);
    await queryRunner.query(`DROP TABLE "evidence_set_articles"`);
    await queryRunner.query(`DROP TABLE "evidence_sets"`);
  }
}
