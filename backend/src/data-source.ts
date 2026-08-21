import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";
import "dotenv/config";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL ?? "postgres://tessera:tessera@localhost:5432/tessera",
  entities: [path.join(__dirname, "entities", "*.entity.{ts,js}")],
  migrations: [path.join(__dirname, "migrations", "*.{ts,js}")],
  synchronize: false,
  logging: false,
});
