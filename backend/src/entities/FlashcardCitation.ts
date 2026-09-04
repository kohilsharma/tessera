import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Article } from "./Article";
import { Flashcard } from "./Flashcard";

@Entity("flashcard_citations")
export class FlashcardCitation {
  @PrimaryColumn({ type: "uuid" })
  flashcardId!: string;

  @PrimaryColumn({ type: "varchar" })
  evidenceId!: string;

  @ManyToOne(() => Flashcard, { onDelete: "CASCADE" })
  @JoinColumn({ name: "flashcardId" })
  flashcard!: Flashcard;

  @ManyToOne(() => Article, { onDelete: "CASCADE" })
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @Column({ type: "uuid" })
  articleId!: string;
}
