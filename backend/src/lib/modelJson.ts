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
// <thought> is Gemma's; <think> is the DeepSeek-R1 lineage's, and models served through
// an OpenAI-compatible host emit either. Both are stripped whole, closed or not.
function withoutThinking(raw: string): string {
  return raw.replace(/<(thought|think)>[\s\S]*?<\/\1>/g, "").replace(/<(thought|think)>[\s\S]*$/, "").trim();
}

export function parseModelObject(raw: string): Record<string, unknown> | null {
  // Rule 0, and it has to come first: a reasoning model puts its working in a
  // <thought> block ahead of the answer, and that working quotes evidence ids, braces
  // and fragments of the schema. Gemma emits an unterminated one when it runs to the
  // token limit, so an unclosed tag drops everything after it too — there is no answer
  // below a thought that never ended. Neither tolerance below can see past this: the
  // greedy brace match starts inside the reasoning and swallows it whole.
  const thought = withoutThinking(raw);
  const candidates = [thought.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], thought.match(/\{[\s\S]*\}/)?.[0]];
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
