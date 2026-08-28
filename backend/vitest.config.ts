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
    env: { UPLOADS_DIR: join(tmpdir(), "tessera-test-uploads") },
  },
});
