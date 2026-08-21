import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";
import "dotenv/config";
import { InitPgvector1755740000000 } from "./migrations/1755740000000-InitPgvector";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL ?? "postgres://tessera:tessera@localhost:5433/tessera",
  // ponytail: entities still glob-loaded (no entities exist yet); switch to explicit
  // imports like migrations below once the first entity lands, same loader footgun.
  entities: [path.join(__dirname, "entities", "*.entity.{ts,js}")],
  // Explicit class imports, not a glob: TypeORM's glob loader uses Node's own
  // require()/import() on the file path, which can't parse raw .ts outside a
  // ts-node/tsx-registered process (e.g. inside Vitest workers).
  migrations: [InitPgvector1755740000000],
  synchronize: false,
  logging: false,
});
