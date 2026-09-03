import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

// The one source of truth for the role vocabulary. Anything that needs to
// enumerate roles (seed script, per-role aggregates) maps over USER_ROLES rather
// than re-listing them — the users.role CHECK constraint must agree with this.
export const REGISTRABLE_ROLES = ["student", "investor"] as const;
export const USER_ROLES = [...REGISTRABLE_ROLES, "admin"] as const;
export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];
export type UserRole = (typeof USER_ROLES)[number];

// The *other* axis of DESIGN.md §3. The role picks the theme and the user cannot
// override it (#75); light/dark is the half they can, so it is the only display
// preference this row carries. 'system' is a real stored value rather than NULL —
// three names in the column are three names in the UI, with no null to map at
// either boundary — and it means "follow prefers-color-scheme", which is a
// standing instruction, not the absence of one. Spelled the platform's way
// (color-scheme, prefers-color-scheme) because that is what it selects between.
export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

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

  @Column({ type: "varchar", default: "system" })
  colorMode!: ColorMode;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
