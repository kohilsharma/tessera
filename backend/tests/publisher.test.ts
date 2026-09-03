import { describe, expect, it } from "vitest";
import { TERMS_CLASSES, mayServeText, mayStoreText } from "../src/entities/Publisher";

// The rights policy, at the seam that decides it. ADR-0032 relaxed what these two
// answer for a non-commercial course build; the vocabulary and both functions
// stayed, so re-tightening is a change here and nowhere else.
describe("mayServeText", () => {
  it("serves every rung for licensed, extracted bodies included", () => {
    // The whole point of ADR-0032: `api_content` is text Tessera fetched, stored,
    // embedded and reasoned over, and refusing to show it left "says who?" opening
    // onto nothing.
    expect(mayServeText("licensed", "api_content")).toBe(true);
    expect(mayServeText("licensed", "feed_excerpt")).toBe(true);
    expect(mayServeText("licensed", "licensed_full_text")).toBe(true);
    expect(mayServeText("licensed", "manual_fixture")).toBe(true);
  });

  it("serves only feed excerpts for syndicated_excerpt", () => {
    expect(mayServeText("syndicated_excerpt", "feed_excerpt")).toBe(true);
    expect(mayServeText("syndicated_excerpt", "licensed_full_text")).toBe(false);
    expect(mayServeText("syndicated_excerpt", "api_content")).toBe(false);
  });

  it("serves nothing for the two classes that cleared no text", () => {
    for (const termsClass of ["internal_only", "open_metadata"] as const) {
      expect(mayServeText(termsClass, "feed_excerpt")).toBe(false);
      expect(mayServeText(termsClass, "api_content")).toBe(false);
      expect(mayServeText(termsClass, "licensed_full_text")).toBe(false);
    }
  });
});

describe("mayStoreText", () => {
  // ADR-0032 moved storage off the class and onto one global answer, so ingestion
  // has no path left that throws away a body it fetched.
  it("holds text for analysis whatever the class", () => {
    for (const termsClass of TERMS_CLASSES) {
      expect(mayStoreText(termsClass)).toBe(true);
    }
  });
});
