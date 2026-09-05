import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserActive1755773000000 implements MigrationInterface {
  name = "AddUserActive1755773000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "active" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "active"`);
  }
}
