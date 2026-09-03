import { MigrationInterface, QueryRunner } from "typeorm";

export class RelaxPublisherTermsPolicy1755767000000 implements MigrationInterface {
  name = "RelaxPublisherTermsPolicy1755767000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #79 / ADR-0032. The vocabulary and its CHECK constraint stay; only the
    // default moves. This is a non-commercial course build, so the fail-closed
    // `internal_only` default was buying nothing and costing everything: every
    // publisher outside the seed is one a connector discovered, so every live
    // Article's text was held back from the reader who asked "says who?".
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "termsClass" SET DEFAULT 'licensed'`);
    // The backfill, and it is deliberately blunt: the column carries no record of
    // whether a value was chosen or inherited, so every `internal_only` publisher
    // is treated as having inherited it. That is true of every row in any database
    // this migration will meet — the seed's publishers are all `licensed` and
    // `seed.ts` re-asserts that on every run — and it is what makes the relaxation
    // visible without a reseed. A deliberate `internal_only` classification made
    // before this migration ran does not survive it; re-apply it by hand.
    await queryRunner.query(`UPDATE "publishers" SET "termsClass" = 'licensed' WHERE "termsClass" = 'internal_only'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The default returns; the backfill cannot, for the reason above — a reverted
    // database re-tightens what arrives next, not what is already there.
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "termsClass" SET DEFAULT 'internal_only'`);
  }
}
