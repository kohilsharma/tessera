import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("publishers")
export class Publisher {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "varchar", unique: true })
  domain!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
