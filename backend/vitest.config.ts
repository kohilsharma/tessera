import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // LocalDiskFileStorageProvider reads UPLOADS_DIR once at module load, so a
    // beforeAll would be too late: set it here, before any test file imports
    // the app. Keeps cover-image uploads out of the real backend/uploads/ tree
    // the way setupTestDb keeps rows out of the real database.
    //
    // GEMINI_API_KEY is forced empty for the same reason: search.ts's embedder
    // is also a module-level singleton, and dotenv/config (loaded by
    // data-source.ts) never overwrites a key already present in process.env —
    // so this wins over a real key sitting in a developer's own .env and keeps
    // ADR-0003's "tests run with no API key" true regardless of local config.
    env: { UPLOADS_DIR: join(tmpdir(), "tessera-test-uploads"), GEMINI_API_KEY: "" },
  },
});
