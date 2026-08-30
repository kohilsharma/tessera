import { describe, expect, it } from "vitest";
import { mayServeText } from "../src/entities/Publisher";

describe("mayServeText", () => {
  it("serves only feed excerpts for syndicated_excerpt", () => {
    expect(mayServeText("syndicated_excerpt", "feed_excerpt")).toBe(true);
    expect(mayServeText("syndicated_excerpt", "licensed_full_text")).toBe(false);
  });
});
