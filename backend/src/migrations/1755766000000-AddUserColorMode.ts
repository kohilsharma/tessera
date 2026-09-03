import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserColorMode1755766000000 implements MigrationInterface {
  name = "AddUserColorMode1755766000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #75. The role decides the theme and is not overridable (DESIGN.md §3), so
    // the only display fact a User row carries is which of the two modes of that
    // theme they want. Existing rows take 'system': the default is to follow the
    // reader's own prefers-color-scheme, and nobody has expressed a preference yet.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "colorMode" varchar NOT NULL DEFAULT 'system'`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_colorMode_check"
        CHECK ("colorMode" IN ('system', 'light', 'dark'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_colorMode_check"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "colorMode"`);
  }
}
