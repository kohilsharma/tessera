import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Article } from "./Article";
import { IntelligenceBrief } from "./IntelligenceBrief";

// ADR-0012's join for the owned entity: which Articles a Brief has pinned, up to
// its articleCapacityLimit (enforced in routes/briefs.ts, not here). Composite PK
// doubles as the "already attached" uniqueness constraint.
@Entity("brief_articles")
export class BriefArticle {
  @PrimaryColumn({ type: "uuid" })
  briefId!: string;

  @PrimaryColumn({ type: "uuid" })
  articleId!: string;

  @ManyToOne(() => IntelligenceBrief)
  @JoinColumn({ name: "briefId" })
  brief!: IntelligenceBrief;

  @ManyToOne(() => Article)
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
