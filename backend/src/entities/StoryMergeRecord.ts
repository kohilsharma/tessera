import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Story } from "./Story";

export type MergedStorySnapshot = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: string;
  firstSeenAt: string;
  lastSeenAt: string;
  clusteringRunId: string | null;
};

export type MergedArticleSnapshot = {
  id: string;
  storyAssignmentStatus: string | null;
  storyAssignmentScore: number | null;
};

export type RejectedAssignmentSnapshot = { articleId: string; rejectedByUserId: string | null; rejectedAt: string };

@Entity("story_merge_records")
export class StoryMergeRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Story, { onDelete: "CASCADE" })
  @JoinColumn({ name: "survivorStoryId" })
  survivorStory!: Story;

  @Column({ type: "uuid" })
  survivorStoryId!: string;

  @Column({ type: "uuid" })
  mergedStoryId!: string;

  @Column({ type: "jsonb" })
  mergedStory!: MergedStorySnapshot;

  @Column({ type: "jsonb" })
  articles!: MergedArticleSnapshot[];

  @Column({ type: "jsonb" })
  rejectedAssignments!: RejectedAssignmentSnapshot[];

  @Column({ type: "uuid", array: true, default: "{}" })
  evidenceSetIds!: string[];

  @Column({ type: "uuid", array: true, default: "{}" })
  generationRunIds!: string[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
