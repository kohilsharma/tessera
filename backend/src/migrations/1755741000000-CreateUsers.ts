import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsers1755741000000 implements MigrationInterface {
  name = "CreateUsers1755741000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar NOT NULL UNIQUE,
        "passwordHash" varchar NOT NULL,
        "role" varchar NOT NULL CHECK ("role" IN ('student', 'investor', 'admin')),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
