import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

export const WATCHLIST_KINDS = ["sector", "ticker"] as const;
export type WatchlistKind = (typeof WATCHLIST_KINDS)[number];

@Entity("watchlist_items")
export class WatchlistItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "ownerId" })
  owner!: User;

  @Column({ type: "uuid" })
  ownerId!: string;

  @Column({ type: "varchar" })
  kind!: WatchlistKind;

  @Column({ type: "varchar" })
  value!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
