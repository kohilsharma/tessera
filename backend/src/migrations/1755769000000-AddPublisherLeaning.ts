import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPublisherLeaning1755769000000 implements MigrationInterface {
  name = "AddPublisherLeaning1755769000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #85 / ADR-0035. `Publisher` gains its second classification axis, and the
    // first one that is somebody else's judgement rather than ours: AllSides'
    // published rating, plus the key of who published it.
    await queryRunner.query(`ALTER TABLE "publishers" ADD COLUMN "leaning" varchar`);
    await queryRunner.query(`ALTER TABLE "publishers" ADD COLUMN "leaningSource" varchar`);
    // AllSides' own five-point vocabulary, stored as they publish it — see
    // PUBLISHER_LEANINGS for why it is not collapsed onto the three-way axis.
    await queryRunner.query(`
      ALTER TABLE "publishers" ADD CONSTRAINT "publishers_leaning_check"
        CHECK ("leaning" IS NULL OR "leaning" IN ('left', 'lean_left', 'center', 'lean_right', 'right'))
    `);
    // The invariant, in the schema rather than in a convention: a rating and its
    // credit are both present or both absent. An uncredited leaning is the
    // model-inferred verdict about a real publisher that ADR-0035 forbids, so
    // there must be no way for one to exist — not by a bug above, not by hand.
    await queryRunner.query(`
      ALTER TABLE "publishers" ADD CONSTRAINT "publishers_leaning_sourced_check"
        CHECK (("leaning" IS NULL) = ("leaningSource" IS NULL))
    `);
    // And the credit has to name a rater Tessera actually reproduces. Without
    // this the pairing above is satisfied by `leaningSource = 'tessera'`, which
    // is precisely the inferred verdict ADR-0035 forbids wearing a citation as a
    // disguise — "no model writes this column" would be a comment rather than a
    // rule. Adding a rater is therefore a migration, and that is the right price:
    // it is a licensing decision (ADR-0035's commercial boundary), not a tweak.
    await queryRunner.query(`
      ALTER TABLE "publishers" ADD CONSTRAINT "publishers_leaning_source_check"
        CHECK ("leaningSource" IS NULL OR "leaningSource" IN ('allsides'))
    `);
    // No backfill: the ratings table is TypeScript (src/lib/publisherLeaning.ts),
    // and restating eighteen third-party claims in SQL would give them a second
    // home to drift from. Every existing Publisher starts *unrated*, which is a
    // true statement about it, and `npm run seed` converges the ones AllSides has
    // rated — the same catch-up path AddPublisherTermsClass1755748000000 used.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "publishers_leaning_source_check"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "publishers_leaning_sourced_check"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "publishers_leaning_check"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "leaningSource"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "leaning"`);
  }
}
