import { describe, expect, it } from "vitest";
import { parseModelObject } from "../src/lib/modelJson";

describe("parsing a model's JSON answer", () => {
  it("takes a bare object, which is what a compliant model and the Mock return", () => {
    expect(parseModelObject('{"claims":[{"text":"a"}]}')).toEqual({ claims: [{ text: "a" }] });
  });

  it("takes a fenced object, which cheap models return even when asked for an object", () => {
    expect(parseModelObject('Here you go:\n```json\n{"title":"Talks resume"}\n```')).toEqual({ title: "Talks resume" });
  });

  // The regression this file exists for. Gemma 4 restates the schema it was asked for
  // inside its reasoning, so the outermost-braces heuristic starts at a brace in the
  // *prose* and swallows the explanation. The fence has to win.
  it("prefers the fence over braces that appear in a model's reasoning", () => {
    const raw = [
      "<thought>Output: JSON format `{claims:[{text, claim_type, citations}]}`.",
      "  Constraints: no extra text.</thought>",
      "```json",
      '{"claims":[{"text":"Rates held steady.","claim_type":"consensus","citations":["A1"]}]}',
      "```",
    ].join("\n");
    expect(raw.match(/\{[\s\S]*\}/)?.[0].startsWith("{claims:")).toBe(true); // what used to be parsed
    expect(parseModelObject(raw)).toEqual({
      claims: [{ text: "Rates held steady.", claim_type: "consensus", citations: ["A1"] }],
    });
  });

  it("falls back to braces when a fence holds something unparseable", () => {
    expect(parseModelObject('```\nnot json\n```\n{"title":"ok"}')).toEqual({ title: "ok" });
  });

  it("answers null for prose, an array, and a truncated object", () => {
    expect(parseModelObject("I cannot answer that.")).toBeNull();
    expect(parseModelObject("[1,2,3]")).toBeNull();
    expect(parseModelObject('```json\n{"claims":[{"text":"Rates held s')).toBeNull();
  });
});
