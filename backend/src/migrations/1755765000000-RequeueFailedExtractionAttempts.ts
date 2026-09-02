import { MigrationInterface, QueryRunner } from "typeorm";

export class RequeueFailedExtractionAttempts1755765000000 implements MigrationInterface {
  name = "RequeueFailedExtractionAttempts1755765000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #70. `discoverExtraction` marks `extractionAttemptedAt` before the fetch —
    // deliberately, so a page that hangs a run is not the page every future run
    // starts on — and the candidate query requires it `IS NULL`. Nothing clears it.
    // So the runs that could never fetch anything (three transport defects, zero
    // successful requests ever, measured 2026-09-01) did not merely fail: they
    // permanently excluded every Article they touched from the pass that repairs
    // them. Fixing the transport alone would leave that backlog stranded.
    //
    // Still on the excerpt rung with a mark against it means the attempt did not
    // raise the Article, which — given that no attempt ever did — is exactly the
    // set those runs poisoned. It re-queues a genuine refusal too (a paywall, a
    // video page under the 600-character floor); that costs one further attempt
    // each, capped at 20 a run and paced at one request per domain per 2 seconds,
    // and is the price of not hand-listing which failures were which.
    //
    // The candidate rule's other two clauses — RSS-discovered, and a Publisher whose
    // Terms Class leaves room for the swap — are deliberately not repeated: only
    // `discoverExtraction` ever writes this column, and it selects on them already,
    // so no row outside the rule holds a mark for this to clear.
    await queryRunner.query(`
      UPDATE "articles"
        SET "extractionAttemptedAt" = NULL
        WHERE "extractionAttemptedAt" IS NOT NULL AND "analysisTextMode" = 'feed_excerpt'
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to undo: the column is unchanged, and the marks this cleared carried
    // no information beyond "attempted", which the next run restores. Re-marking
    // every excerpt-rung Article on rollback would re-create the exclusion this
    // migration exists to lift.
  }
}
