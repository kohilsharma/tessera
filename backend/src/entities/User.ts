import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

// The one source of truth for the role vocabulary. Anything that needs to
// enumerate roles (seed script, per-role aggregates) maps over USER_ROLES rather
// than re-listing them — the users.role CHECK constraint must agree with this.
export const REGISTRABLE_ROLES = ["student", "investor"] as const;
export const USER_ROLES = [...REGISTRABLE_ROLES, "admin"] as const;
export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];
export type UserRole = (typeof USER_ROLES)[number];

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  email!: string;

  @Column({ type: "varchar" })
  passwordHash!: string;

  @Column({ type: "varchar" })
  role!: UserRole;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
