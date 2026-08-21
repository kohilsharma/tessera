import { afterAll, beforeAll } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AppDataSource } from "../src/data-source";

// Every API-seam test file needs its own ephemeral Postgres+pgvector, migrated
// fresh, plus the same JWT_SECRET fallback so signToken/verifyToken agree on a
// secret when the developer has no .env. Call once per test file.
export function setupTestDb(): void {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= "test-only-secret";

    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("tessera_test")
      .withUsername("tessera")
      .withPassword("tessera")
      .start();

    AppDataSource.setOptions({ url: container.getConnectionUri() });
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  }, 60_000);

  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    if (container) await container.stop();
  });
}
