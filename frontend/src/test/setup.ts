import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Every test drives the components through the real api/client module, so the
// only thing stubbed is the network itself — the seam the spec names ("external
// behavior at a seam, never internal implementation details").
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
