import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AnalysisClaim } from "./AnalysisClaim";
import { GenerationRun } from "./GenerationRun";
import { User } from "./User";

// CONTEXT.md "Flashcard" (ADR-0021): a Student-owned Q/A study card whose answer is
// cited into a frozen EvidenceSet, scheduled by spaced repetition.
//
// The answer is not a column. A card *is* an AnalysisClaim with a question in front
// of it: the claim carries the text and the ClaimEvidence rows that resolve into its
// run's frozen set, both written below the prompt by validation (ADR-0002). So
// "every card's answer cites evidence from a frozen EvidenceSet" is not a rule this
// table enforces — it is the only shape it can hold. Copying the claim text here
// would be a second, uncited copy of the one thing that must stay cited.
//
// The question is the one thing a card adds, and it is the only part a model wrote
// for it (flashcards/questions.ts). Everything else on the row is scheduling.
@Entity("flashcards")
export class Flashcard {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Owned, unlike the analysis it is drawn from: a GenerationRun belongs to its
  // Story and is shared, a card belongs to the Student who made it and to nobody
  // else (ADR-0004). Their review history is theirs, so a deleted account takes its
  // cards with it.
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerId" })
  owner!: User;

  @Column({ type: "uuid" })
  ownerId!: string;

  // Which analysis this card was made from. Redundant against `claim.generationRunId`
  // and kept anyway: a deck is asked for per run ("make cards from this analysis"),
  // and reading it back through every claim to find out which run it came from would
  // be a join for a fact the request already knew.
  @ManyToOne(() => GenerationRun, { onDelete: "CASCADE" })
  @JoinColumn({ name: "generationRunId" })
  generationRun!: GenerationRun;

  @Column({ type: "uuid" })
  generationRunId!: string;

  @ManyToOne(() => AnalysisClaim, { onDelete: "CASCADE" })
  @JoinColumn({ name: "claimId" })
  claim!: AnalysisClaim;

  @Column({ type: "uuid" })
  claimId!: string;

  @Column({ type: "text" })
  question!: string;

  // SM-2's three state variables (flashcards/sm2.ts). Named as the algorithm names
  // them so the code that advances them reads like the algorithm it implements.
  @Column({ type: "integer", default: 0 })
  repetitions!: number;

  @Column({ type: "double precision", default: 2.5 })
  easeFactor!: number;

  @Column({ type: "integer", default: 0 })
  intervalDays!: number;

  // A new card is due immediately: a Student who just made a deck is studying it
  // now, and the schedule starts at their first answer.
  @Column({ type: "timestamptz" })
  dueAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastReviewedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
