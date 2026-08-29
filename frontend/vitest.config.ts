import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The secondary seam (Phase 1 spec, Testing Decisions): component/interaction
// tests over the components that carry real state logic, asserting the four UI
// states and form-submission behaviour. The API seam stays in backend/tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
