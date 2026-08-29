import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";

@Entity("publishers")
export class Publisher {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "varchar", unique: true })
  domain!: string;

  @OneToMany(() => Article, (article) => article.publisher)
  articles!: Article[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
