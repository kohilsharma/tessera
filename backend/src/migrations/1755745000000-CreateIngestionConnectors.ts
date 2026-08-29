import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIngestionConnectors1755745000000 implements MigrationInterface {
  name = "CreateIngestionConnectors1755745000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ingestion_connectors" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL UNIQUE,
        "kind" varchar NOT NULL CHECK ("kind" IN ('gdelt_gkg', 'gdelt_doc', 'rss')),
        "endpoint" varchar NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ingestion_connectors"`);
  }
}
