import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEntityMergeReview1755764000000 implements MigrationInterface {
  name = "CreateEntityMergeReview1755764000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Trigram matching is Postgres's own, and it is what generates merge candidates —
    // no embedding of a bare name string, no model adjudication (#67).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // A merge that is not remembered by name is undone within the hour: every pass
    // re-promotes each folded name it still finds above the floor, so deleting the
    // merged Entity alone would resurrect it on the next tick. The alias is read by
    // the pass's fold, which is what makes a merged name never promote again and its
    // annotations land on the survivor instead.
    //
    // Every stored target is terminal — merging B into C repoints A -> B at C rather
    // than leaving a chain — so one lookup resolves a name however often it has moved.
    await queryRunner.query(`
      CREATE TABLE "entity_aliases" (
        "kind" varchar NOT NULL CHECK ("kind" IN ('person', 'organization', 'location')),
        "normalizedName" text NOT NULL,
        "featureKey" text NOT NULL DEFAULT '',
        "targetNormalizedName" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        PRIMARY KEY ("kind", "normalizedName", "featureKey"),
        CONSTRAINT "CHK_entity_aliases_not_self" CHECK ("targetNormalizedName" <> "normalizedName")
      )
    `);
    // The repoint above looks up by target, not by key.
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_aliases_target" ON "entity_aliases" ("kind", "featureKey", "targetNormalizedName")`,
    );

    // A refusal is remembered by name, not by Entity id — the deliberate divergence
    // from the clustering precedent, where a Rejected pairing keys on row ids because
    // a Story is durable. An Entity is a working-set row that may roll out of the
    // window and be promoted again next month; the judgement that two names are not
    // the same thing survives that, so it outlives the Entities themselves.
    //
    // The pair is unordered — refusing (A, B) refuses (B, A) — stored ordered so one
    // index is the whole check.
    await queryRunner.query(`
      CREATE TABLE "entity_merge_refusals" (
        "kind" varchar NOT NULL CHECK ("kind" IN ('person', 'organization', 'location')),
        "featureKey" text NOT NULL DEFAULT '',
        "normalizedNameA" text NOT NULL,
        "normalizedNameB" text NOT NULL,
        "refusedByUserId" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "refusedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        PRIMARY KEY ("kind", "featureKey", "normalizedNameA", "normalizedNameB"),
        CONSTRAINT "CHK_entity_merge_refusals_ordered" CHECK ("normalizedNameA" < "normalizedNameB")
      )
    `);
    // Deleting the Admin who refused must not re-open the refusal, hence SET NULL
    // above; the column cascades, so it is indexed.
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_merge_refusals_refusedByUserId" ON "entity_merge_refusals" ("refusedByUserId")`,
    );

    // A proposal changes nothing. It is derived state — each pass refreshes what it
    // measured and drops the pairs it no longer stages — but keyed on the pair, so an open
    // proposal keeps its id across every pass that re-derives it: the id is what an Admin's
    // decision names, and one that churned hourly would 404 the decision. The two Article
    // counts are stored because they are what the pass measured and what fixed the
    // orientation — the reviewer sees the same numbers the survivor was chosen by.
    await queryRunner.query(`
      CREATE TABLE "entity_merge_proposals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "survivorEntityId" uuid NOT NULL REFERENCES "entities" ("id") ON DELETE CASCADE,
        "mergedEntityId" uuid NOT NULL REFERENCES "entities" ("id") ON DELETE CASCADE,
        "similarity" real NOT NULL,
        "survivorArticleCount" integer NOT NULL,
        "mergedArticleCount" integer NOT NULL,
        CONSTRAINT "CHK_entity_merge_proposals_distinct" CHECK ("survivorEntityId" <> "mergedEntityId")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_entity_merge_proposals_pair"
         ON "entity_merge_proposals" ("survivorEntityId", "mergedEntityId")`,
    );
    // Demoting an Entity drops its proposals; the A side is covered by the pair index.
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_merge_proposals_mergedEntityId" ON "entity_merge_proposals" ("mergedEntityId")`,
    );

    // Both counters count *pairs*, so they sit outside the run ledger's
    // promoted + belowFloor = considered identity, which counts names.
    await queryRunner.query(`
      ALTER TABLE "entity_resolution_runs"
        ADD "merged" integer NOT NULL DEFAULT 0,
        ADD "proposed" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "entity_resolution_runs" DROP COLUMN "proposed", DROP COLUMN "merged"`);
    await queryRunner.query(`DROP TABLE "entity_merge_proposals"`);
    await queryRunner.query(`DROP TABLE "entity_merge_refusals"`);
    await queryRunner.query(`DROP TABLE "entity_aliases"`);
  }
}
