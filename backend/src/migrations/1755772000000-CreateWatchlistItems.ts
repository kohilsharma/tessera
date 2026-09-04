import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWatchlistItems1755772000000 implements MigrationInterface {
  name = "CreateWatchlistItems1755772000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "watchlist_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ownerId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "kind" varchar NOT NULL CHECK ("kind" IN ('sector', 'ticker')),
        "value" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_watchlist_owner_kind_value" UNIQUE ("ownerId", "kind", "value")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_watchlist_items_owner" ON "watchlist_items" ("ownerId", "createdAt" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_watchlist_items_owner"`);
    await queryRunner.query(`DROP TABLE "watchlist_items"`);
  }
}
