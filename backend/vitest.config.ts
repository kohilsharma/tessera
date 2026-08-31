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
    // Every provider key is forced empty for the same reason: search.ts's
    // embedder is also a module-level singleton, and dotenv/config (loaded by
    // data-source.ts) never overwrites a key already present in process.env —
    // so this wins over a real key sitting in a developer's own .env and keeps
    // ADR-0003's "tests run with no API key" true regardless of local config.
    // Both selection functions (ADR-0025) read a provider name *and* a key, and
    // either alone is enough to send the suite to the network, so the whole set
    // is pinned rather than the keys only. The model and base pairs are pinned
    // alongside them because .env.example ships them uncommented: a developer
    // who copied that file would otherwise change the model id and endpoint
    // that the provider tests assert against.
    env: {
      UPLOADS_DIR: join(tmpdir(), "tessera-test-uploads"),
      EMBEDDING_PROVIDER: "",
      EMBEDDING_API_KEY: "",
      EMBEDDING_INPUT_STYLE: "",
      GEMINI_API_KEY: "",
      EMBEDDING_MODEL: "",
      EMBEDDING_API_BASE: "",
      SYNTHESIS_PROVIDER: "",
      SYNTHESIS_API_KEY: "",
      SYNTHESIS_MODEL: "",
      SYNTHESIS_API_BASE: "",
    },
  },
});
