import { MigrationInterface, QueryRunner } from "typeorm";

// The shipped template's parameters, as src/entities/PromptTemplate.ts's
// DEFAULT_PROMPT_PARAMS stood at this date — inlined rather than imported, the same way
// this directory's other vocabularies are: a migration describes what happened, and
// importing a constant would let a later edit rewrite history.
const SHIPPED_PARAMS = {
  tone: "",
  claimCount: { min: 3, max: 6 },
  lensEmphasis: "",
  surfacedClaimTypes: ["consensus", "source_specific", "contradiction"],
};

// generation/config.ts's PROMPT_VERSION at this date. The template test asserts a
// migrated database's current version equals that constant, so a prompt change that
// bumps it without shipping a row carrying the new label fails the suite rather than
// quietly serving cached analyses written under the old prompt.
const SHIPPED_VERSION = "2026-09-03";

export class CreatePromptTemplates1755760000000 implements MigrationInterface {
  name = "CreatePromptTemplates1755760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADR-0021's Admin tuning surface (#57). Rows are immutable — tuning is creating a
    // version, not editing one — which is what makes `generation_runs.promptVersion`
    // resolve to the parameters that produced a run for as long as the run exists. So
    // there is no updatedAt, and nothing here is ON DELETE CASCADE.
    await queryRunner.query(`
      CREATE TABLE "prompt_templates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" varchar NOT NULL UNIQUE,
        "params" jsonb NOT NULL,
        "isCurrent" boolean NOT NULL DEFAULT false,
        "createdByUserId" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // At most one current version, decided by the database rather than by the code that
    // flips the flag: activation clears the old row and sets the new one, and a lost
    // race must not leave a pipeline that has two prompts to choose from.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_prompt_templates_current" ON "prompt_templates" ("isCurrent") WHERE "isCurrent"`,
    );

    // Seeded here rather than in src/seed.ts: the flagship reads this row on every
    // request, so it is what makes a migrated database work — not demo content. Its
    // parameters are exactly the prompt this pipeline asked for before it was tunable,
    // so applying this migration changes no output.
    await queryRunner.query(
      `INSERT INTO "prompt_templates" ("version", "params", "isCurrent") VALUES ($1, $2, true)`,
      [SHIPPED_VERSION, JSON.stringify(SHIPPED_PARAMS)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Past runs keep their promptVersion string, which is why this drop loses history
    // rather than corrupting it: a run still says which version wrote it, there is just
    // nothing left to look the label up in.
    await queryRunner.query(`DROP INDEX "UQ_prompt_templates_current"`);
    await queryRunner.query(`DROP TABLE "prompt_templates"`);
  }
}
