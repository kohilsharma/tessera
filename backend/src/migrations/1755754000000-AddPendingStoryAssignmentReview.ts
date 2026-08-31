import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPendingStoryAssignmentReview1755754000000 implements MigrationInterface {
  name = "AddPendingStoryAssignmentReview1755754000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #50 splits the old three-way ledger: an Article held for review is neither
    // assigned nor unclustered. Existing rows were written before the band existed,
    // so 0 is the true value for them, not a placeholder.
    await queryRunner.query(`ALTER TABLE "clustering_runs" ADD COLUMN "heldForReview" integer NOT NULL DEFAULT 0`);

    // The pairing is the primary key: a rejection is remembered once, and an Admin
    // rejecting the same proposal twice writes nothing new.
    await queryRunner.query(`
      CREATE TABLE "rejected_story_assignments" (
        "articleId" uuid NOT NULL REFERENCES "articles" ("id") ON DELETE CASCADE,
        "storyId" uuid NOT NULL REFERENCES "stories" ("id") ON DELETE CASCADE,
        "rejectedByUserId" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "rejectedAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("articleId", "storyId")
      )
    `);

    // The review queue's own index: partial, because pending is a small minority of
    // a corpus that is mostly firehose metadata, and ordered by score because that
    // is how the queue is read — the most confident proposals first.
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_pending_review" ON "articles" ("storyAssignmentScore" DESC)
       WHERE "storyAssignmentStatus" = 'pending_review'`,
    );

    // A Story Assignment exists exactly when there is a Story to assign to. Worth a
    // constraint rather than a convention because #50 changed what the columns mean
    // together: read paths now test the *status*, so a row carrying a storyId with
    // no decision on it would be silently invisible everywhere — clustered, and
    // absent from browse, search and evidence with nothing to explain why. This
    // turns that into a failed insert at the moment it is written.
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "CHK_articles_story_assignment_pairing"
       CHECK (("storyId" IS NULL) = ("storyAssignmentStatus" IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "CHK_articles_story_assignment_pairing"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_pending_review"`);
    await queryRunner.query(`DROP TABLE "rejected_story_assignments"`);
    await queryRunner.query(`ALTER TABLE "clustering_runs" DROP COLUMN "heldForReview"`);
  }
}
