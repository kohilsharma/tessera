import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { CORE_CLAIM_TYPES, type CoreClaimType } from "./AnalysisClaim";
import { User } from "./User";

// CONTEXT.md "PromptTemplate": a versioned prompt + generation-params record an Admin
// tunes to shape what every reader gets. ADR-0021's hard guardrail is the shape of this
// type, not a note beside it — every field below is something the *prompt asks for*, and
// nothing below is read by validate.ts. There is deliberately no field for a phrase list,
// a claim floor, a citation rule or a "strict" flag: the invariant lives in backend code
// under the prompt and is not addressable from here at all.
//
// The four knobs are CONTEXT.md's four: tone, verbosity (how many claims), lens emphasis,
// and which claim types surface.
export type PromptParams = {
  // One clause naming the register to write in, or empty for none. Normalised to a
  // single line with brackets neutralised when it is accepted (generation/template.ts),
  // so tuned text is one instruction among the others rather than a way to write new
  // ones — and cannot forge an evidence id.
  tone: string;
  // Verbosity, as the thing verbosity actually means here: how many claims the answer
  // should carry. Bounded below by what validation will publish and above by what a
  // cheap model can return inside one response.
  claimCount: { min: number; max: number };
  // Appended to the Lens instruction — what this audience should be told to weigh.
  lensEmphasis: string;
  // Which of the three core claim types the prompt asks for. The run's own Lens claim
  // is not listed: a run carries exactly one Lens (ADR-0010), so it is never optional.
  //
  // Narrowing this narrows the *request*, never the check. A model that returns a
  // contradiction nobody asked for is still validated and still displayed if it holds
  // up — because what may be shown is decided below the prompt, which is the whole
  // point of ADR-0021's guardrail.
  surfacedClaimTypes: CoreClaimType[];
};

// The shipped template's parameters: exactly the prompt this pipeline asked for before
// it was tunable, so the migration that seeds them changes no behaviour. Also the
// fallback when no row is current, so the flagship cannot be taken down by a missing
// configuration row.
export const DEFAULT_PROMPT_PARAMS: PromptParams = {
  tone: "",
  claimCount: { min: 3, max: 6 },
  lensEmphasis: "",
  surfacedClaimTypes: [...CORE_CLAIM_TYPES],
};

// Immutable once created: tuning is *creating a version*, not editing one. That is what
// makes `generation_runs.promptVersion` traceable — a label resolves to the parameters
// that produced the run, forever — and it is why the only mutation here is which row is
// current. Nothing deletes a row either, so a past analysis stays explicable after the
// prompt has moved on (ADR-0021).
@Entity("prompt_templates")
export class PromptTemplate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // The label recorded on every GenerationRun, and the third part of generation's reuse
  // key — so activating a different version invalidates every cached analysis by
  // design. UNIQUE, because a run that cannot be resolved back to one set of parameters
  // is not traceable to anything.
  @Column({ type: "varchar" })
  version!: string;

  @Column({ type: "jsonb" })
  params!: PromptParams;

  // At most one row is current, enforced by a partial unique index rather than by the
  // code that flips it.
  @Column({ type: "boolean", default: false })
  isCurrent!: boolean;

  // Nullable for the reason GenerationRun.triggeredByUserId is: the shipped version has
  // no person behind it, and a deleted account must not take the prompt every reader's
  // analysis was written under.
  @ManyToOne(() => User)
  @JoinColumn({ name: "createdByUserId" })
  createdByUser!: User | null;

  @Column({ type: "uuid", nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
