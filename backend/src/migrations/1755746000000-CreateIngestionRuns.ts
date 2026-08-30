import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIngestionRuns1755746000000 implements MigrationInterface {
  name = "CreateIngestionRuns1755746000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CONTEXT.md "Unclustered Article": everything ingestion produces has no
    // Story until Phase 3 clusters it. Dropping NOT NULL is the whole mechanism
    // — every public read path already joins through Story, so unclustered rows
    // are invisible to browse and search by construction rather than by a filter
    // someone has to remember (ADR-0022).
    await queryRunner.query(`ALTER TABLE "articles" ALTER COLUMN "storyId" DROP NOT NULL`);

    // Provenance per Article. Nullable because seeded fixtures were not
    // discovered by a connector — which also makes real the Connector-to-Article
    // relationship the Initial Report already asserted. SET NULL rather than
    // CASCADE: losing a connector row must not delete the reporting it found.
    await queryRunner.query(`
      ALTER TABLE "articles" ADD COLUMN "discoveredByConnectorId" uuid
        REFERENCES "ingestion_connectors"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "ingestion_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "connectorId" uuid NOT NULL REFERENCES "ingestion_connectors"("id") ON DELETE CASCADE,
        "status" varchar NOT NULL CHECK ("status" IN ('running', 'succeeded', 'failed')),
        "startedAt" timestamptz NOT NULL,
        "completedAt" timestamptz,
        "discovered" integer NOT NULL DEFAULT 0,
        "inserted" integer NOT NULL DEFAULT 0,
        "enriched" integer NOT NULL DEFAULT 0,
        "duplicate" integer NOT NULL DEFAULT 0,
        "rejectedByPolicy" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "errorSummary" text,
        "cursor" varchar
      )
    `);
    // The Admin surface reads history newest first, per connector.
    await queryRunner.query(
      `CREATE INDEX "IDX_ingestion_runs_connector_startedAt" ON "ingestion_runs" ("connectorId", "startedAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ingestion_runs"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "discoveredByConnectorId"`);
    // Only reversible while no unclustered Articles exist — which is the point of
    // a down migration on a schema that has not shipped rows yet.
    await queryRunner.query(`ALTER TABLE "articles" ALTER COLUMN "storyId" SET NOT NULL`);
  }
}
