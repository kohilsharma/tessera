import "reflect-metadata";
import { DataSource } from "typeorm";
import "dotenv/config";
import { InitPgvector1755740000000 } from "./migrations/1755740000000-InitPgvector";

const url = process.env.DATABASE_URL;

// Fail loudly rather than let the pg driver fall back to its own localhost:5432
// defaults, which on a dev machine is likely a *different* project's database.
// Tests inject a Testcontainers URL via setOptions() after this module loads.
if (!url && process.env.NODE_ENV !== "test") {
  throw new Error("DATABASE_URL is not set — copy backend/.env.example to backend/.env (see SETUP.md).");
}

export const AppDataSource = new DataSource({
  type: "postgres",
  url,
  entities: [],
  // Explicit class imports, not a glob: TypeORM's glob loader uses Node's own
  // require()/import() on the file path, which can't parse raw .ts outside a
  // ts-node/tsx-registered process (e.g. inside Vitest workers). Add entity
  // classes to the array above the same way.
  migrations: [InitPgvector1755740000000],
  synchronize: false,
  logging: false,
});
