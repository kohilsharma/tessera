// The one place that turns a model's answer into a JSON object.
//
// Two tolerances, in order, and the order is the whole point:
//
// 1. A fenced ```json block, when there is one. Reasoning-style models (Gemma 4, and
//    every model that thinks out loud before answering) restate the schema they were
//    asked for inside their reasoning — `{claims:[{text, claim_type, citations}]}` —
//    and put the real answer in a fence below it.
// 2. Otherwise the outermost braces, because cheap models fence their JSON even when
//    asked for an object and some prepend a sentence.
//
// Rule 2 alone is what used to be inlined at both call sites, and it is wrong for a
// reasoning model in the way that matters: the greedy match starts at the brace inside
// the *prose*, swallows the explanation, and fails to parse a response that contained a
// perfectly good object. Preferring the fence costs one regex and fixes it.
//
// ADR-0003: none of this is leniency about the schema. Whatever comes back here still
// goes through our own validation — this only decides which span of text to hand it.
export function parseModelObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], raw.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next tolerance rather than giving up: a fence can hold a truncated object.
    }
  }
  return null;
}
