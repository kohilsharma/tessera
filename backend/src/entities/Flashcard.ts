import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AnalysisClaim } from "./AnalysisClaim";
import { GenerationRun } from "./GenerationRun";
import { User } from "./User";
import { EvidenceSet } from "./EvidenceSet";

// CONTEXT.md "Flashcard" (ADR-0021): a Student-owned Q/A study card whose answer is
// cited into a frozen EvidenceSet, scheduled by spaced repetition.
//
// A card owns its question and answer. Its citations live in flashcard_citations and
// must resolve into its frozen EvidenceSet; analysis-born cards retain their claim
// link as the second entry point.
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

  // Which analysis this card was made from. Null for cards generated directly from search.
  // and kept anyway: a deck is asked for per run ("make cards from this analysis"),
  // and reading it back through every claim to find out which run it came from would
  // be a join for a fact the request already knew.
  @ManyToOne(() => GenerationRun, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "generationRunId" })
  generationRun!: GenerationRun;

  @Column({ type: "uuid" })
  generationRunId!: string | null;

  @ManyToOne(() => AnalysisClaim, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "claimId" })
  claim!: AnalysisClaim;

  @Column({ type: "uuid" })
  claimId!: string | null;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "text", default: "" })
  answer!: string;

  @ManyToOne(() => EvidenceSet, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "evidenceSetId" })
  evidenceSet!: EvidenceSet | null;

  @Column({ type: "uuid", nullable: true })
  evidenceSetId!: string | null;

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
