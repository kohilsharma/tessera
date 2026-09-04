import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntityTicker1755770000000 implements MigrationInterface {
  name = "AddEntityTicker1755770000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "entities" ADD COLUMN "ticker" varchar`);
    await queryRunner.query(`
      ALTER TABLE "entities" ADD CONSTRAINT "CHK_entities_ticker"
        CHECK ("ticker" IS NULL OR ("kind" = 'organization' AND "ticker" ~ '^[A-Z][A-Z0-9]{0,6}([.\\-][A-Z]{1,3})?$'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "entities" DROP CONSTRAINT "CHK_entities_ticker"`);
    await queryRunner.query(`ALTER TABLE "entities" DROP COLUMN "ticker"`);
  }
}
