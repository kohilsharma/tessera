import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Article } from "./Article";
import { Story } from "./Story";
import { User } from "./User";

// An Admin's refusal of a proposed Story Assignment (CONTEXT.md), remembered so
// later clustering runs do not put the same pairing back in the queue. Without
// this a rejection lasts until the next hourly run: the Article returns to
// Unclustered, scores the same Story the same way, and is proposed again — which
// makes the review queue unworkable rather than merely noisy.
//
// The pairing *is* the row identity, so a composite primary key rather than a
// surrogate id plus a hand-added unique index: the same (Article, Story) can be
// refused once, and re-refusing it is a no-op rather than a second row.
//
// ponytail: the memory is per pairing, not per Article — a rejected Article is
// still offered every *other* live Story, which is what a reviewer rejecting "this
// is the wrong event" means. If it turns out reviewers mean "stop proposing this
// Article at all", the upgrade path is a nullable storyId meaning "any".
@Entity("rejected_story_assignments")
export class RejectedStoryAssignment {
  @PrimaryColumn({ type: "uuid" })
  articleId!: string;

  @ManyToOne(() => Article, { onDelete: "CASCADE" })
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @PrimaryColumn({ type: "uuid" })
  storyId!: string;

  @ManyToOne(() => Story, { onDelete: "CASCADE" })
  @JoinColumn({ name: "storyId" })
  story!: Story;

  // Who refused it. Nullable, and ON DELETE SET NULL: a deleted account must not
  // take the refusal with it, or removing an Admin would silently re-open every
  // pairing they closed.
  @Column({ type: "uuid", nullable: true })
  rejectedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "rejectedByUserId" })
  rejectedBy!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  rejectedAt!: Date;
}
