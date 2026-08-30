import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGkgAnnotations1755750000000 implements MigrationInterface {
  name = "CreateGkgAnnotations1755750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #43: one staging table for all four kinds GKG already extracted, rather
    // than a table each. They are read the same way — every row of one Article,
    // then self-joined — so splitting them would turn one index scan into four
    // and one union back together.
    //
    // CASCADE on the Article: these rows are derived from it and are meaningless
    // without it, so retention (#45) deleting an Article takes its annotations
    // with it instead of leaving orphans behind.
    await queryRunner.query(`
      CREATE TABLE "gkg_annotations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "articleId" uuid NOT NULL REFERENCES "articles"("id") ON DELETE CASCADE,
        "kind" varchar NOT NULL CHECK ("kind" IN ('person', 'organization', 'location', 'theme')),
        "surfaceName" varchar(512) NOT NULL,
        "charOffset" integer NOT NULL CHECK ("charOffset" >= 0),
        "locationDetail" jsonb
      )
    `);

    // One occurrence is one row, and re-reading the same window must not stage it
    // twice — so the occurrence itself is the identity and the staging insert can
    // be an idempotent ON CONFLICT DO NOTHING.
    //
    // Leading with "articleId" makes this the index the per-Article read and the
    // co-occurrence self-join both use, so no second index is needed yet.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gkg_annotations_occurrence"
        ON "gkg_annotations" ("articleId", "kind", "surfaceName", "charOffset")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "gkg_annotations"`);
  }
}
