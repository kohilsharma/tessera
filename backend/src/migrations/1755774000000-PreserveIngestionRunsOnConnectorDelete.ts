import { MigrationInterface, QueryRunner } from "typeorm";

export class PreserveIngestionRunsOnConnectorDelete1755774000000 implements MigrationInterface {
  name = "PreserveIngestionRunsOnConnectorDelete1755774000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ingestion_runs" ADD COLUMN "connectorName" varchar`);
    await queryRunner.query(`
      UPDATE "ingestion_runs" run
      SET "connectorName" = connector.name
      FROM "ingestion_connectors" connector
      WHERE connector.id = run."connectorId"
    `);

    const table = await queryRunner.getTable("ingestion_runs");
    const foreignKey = table?.foreignKeys.find((key) => key.columnNames.includes("connectorId"));
    if (foreignKey) await queryRunner.dropForeignKey("ingestion_runs", foreignKey);
    await queryRunner.query(`ALTER TABLE "ingestion_runs" ALTER COLUMN "connectorId" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "ingestion_runs"
      ADD CONSTRAINT "FK_ingestion_runs_connector_set_null"
      FOREIGN KEY ("connectorId") REFERENCES "ingestion_connectors"("id") ON DELETE SET NULL
    `);
  }

  // Destructive, and only in one direction: going back re-imposes NOT NULL, so
  // every run whose connector an Admin deleted — precisely the history `up` exists
  // to retain — has nowhere to go and is deleted, and dropping `connectorName`
  // discards the snapshot that made those rows readable. Reversible without loss
  // only while no connector has been deleted. Stated here for the same reason
  // 1755746000000 states its own: a down migration that quietly takes evidence out
  // is worse than one that refuses.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ingestion_runs" DROP CONSTRAINT "FK_ingestion_runs_connector_set_null"`);
    await queryRunner.query(`
      DELETE FROM "ingestion_runs" WHERE "connectorId" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "ingestion_runs" ALTER COLUMN "connectorId" SET NOT NULL`);
    // The name Postgres gave the constraint 1755746000000 created inline, so the
    // schema this restores is the one that migration built rather than a lookalike.
    await queryRunner.query(`ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ingestion_connectors"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "ingestion_runs" DROP COLUMN "connectorName"`);
  }
}
