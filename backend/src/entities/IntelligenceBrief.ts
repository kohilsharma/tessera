import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { BriefArticle } from "./BriefArticle";
import { STORY_CATEGORIES, StoryCategory } from "./Story";
import { User } from "./User";

// ADR-0012: the course's mandated "owned core business entity". articleCapacityLimit
// is real business logic (enforced via BriefArticle count in routes/briefs.ts), not a
// token field. coverImageKey is a StorageProvider key (see routes/briefs.ts's
// cover-image upload), nullable until an owner uploads one.
export const DEFAULT_ARTICLE_CAPACITY_LIMIT = 20;

@Entity("intelligence_briefs")
export class IntelligenceBrief {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "varchar" })
  category!: StoryCategory;

  @Column({ type: "int", default: DEFAULT_ARTICLE_CAPACITY_LIMIT })
  articleCapacityLimit!: number;

  @Column({ type: "varchar", nullable: true })
  coverImageKey!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "ownerId" })
  owner!: User;

  @Column({ type: "uuid" })
  ownerId!: string;

  @OneToMany(() => BriefArticle, (briefArticle) => briefArticle.brief)
  briefArticles!: BriefArticle[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}

export { STORY_CATEGORIES as BRIEF_CATEGORIES };
