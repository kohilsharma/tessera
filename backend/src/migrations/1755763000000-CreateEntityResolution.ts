import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEntityResolution1755763000000 implements MigrationInterface {
  name = "CreateEntityResolution1755763000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "kind" varchar NOT NULL CHECK ("kind" IN ('person', 'organization', 'location')),
        "canonicalName" text NOT NULL,
        "normalizedName" text NOT NULL,
        "featureId" varchar
      )
    `);
    // Identity, and the target the pass's ON CONFLICT infers on. A location's
    // FeatureID is part of it (two places share a name); the other kinds have none,
    // and NULL is not equal to NULL, so the coalesce is what makes one index serve
    // both — expressed here rather than by storing '' and pretending it is an id.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_entities_identity"
         ON "entities" ("kind", "normalizedName", (COALESCE("featureId", '')))`,
    );

    await queryRunner.query(`
      CREATE TABLE "entity_edges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "entityAId" uuid NOT NULL REFERENCES "entities" ("id") ON DELETE CASCADE,
        "entityBId" uuid NOT NULL REFERENCES "entities" ("id") ON DELETE CASCADE,
        "articleId" uuid NOT NULL REFERENCES "articles" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_entity_edges_ordered" CHECK ("entityAId" < "entityBId")
      )
    `);
    // One citation per pair per Article: an Article naming both twice is one
    // observation of one edge, not two.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_entity_edges_citation" ON "entity_edges" ("entityAId", "entityBId", "articleId")`,
    );
    // Postgres indexes neither side of a foreign key for you, and all three of these
    // columns cascade: retention deletes GDELT Articles every quarter hour and a pass
    // deletes demoted Entities, so an unindexed referencing column is a sequential
    // scan of the edge table on the routine path. The A side is covered above.
    await queryRunner.query(`CREATE INDEX "IDX_entity_edges_entityBId" ON "entity_edges" ("entityBId")`);
    await queryRunner.query(`CREATE INDEX "IDX_entity_edges_articleId" ON "entity_edges" ("articleId")`);

    await queryRunner.query(`
      CREATE TABLE "entity_resolution_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" varchar NOT NULL CHECK ("status" IN ('running', 'succeeded', 'failed')),
        "startedAt" timestamptz NOT NULL,
        "completedAt" timestamptz,
        "annotationsRead" integer NOT NULL DEFAULT 0,
        "articlesRead" integer NOT NULL DEFAULT 0,
        "considered" integer NOT NULL DEFAULT 0,
        "promoted" integer NOT NULL DEFAULT 0,
        "belowFloor" integer NOT NULL DEFAULT 0,
        "demoted" integer NOT NULL DEFAULT 0,
        "edgesBuilt" integer NOT NULL DEFAULT 0,
        "errorSummary" text
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_resolution_runs_startedAt" ON "entity_resolution_runs" ("startedAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "entity_resolution_runs"`);
    await queryRunner.query(`DROP TABLE "entity_edges"`);
    await queryRunner.query(`DROP TABLE "entities"`);
  }
}
