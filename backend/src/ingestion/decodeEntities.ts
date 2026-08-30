// Shared by both parsers that read markup off the open internet: RSS
// `content:encoded` (CDATA, so never entity-decoded by the XML parser) and GKG's
// `V2EXTRASXML`, which is XML-shaped but not well-formed — real titles carry both
// `&#x2013;` and a bare `&` in the same field, so it cannot be handed to an XML
// parser and its entities have to be decoded here.
//
// The named set is deliberately the handful that appear in real feeds, not the
// full HTML5 table: an unknown entity is left as written rather than guessed at.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// A numeric entity is publisher-supplied and may name nothing storable: past the
// last Unicode code point (String.fromCodePoint throws RangeError), a lone
// surrogate, or NUL — which Postgres rejects inside a text value. Any of those is
// left exactly as written, so one mangled title can never take down the row it is
// in, let alone the run around it.
function fromCodePoint(code: number, whole: string): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole;
  if (code >= 0xd800 && code <= 0xdfff) return whole;
  return String.fromCodePoint(code);
}

export function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#(\d+);/g, (whole, code: string) => fromCodePoint(Number(code), whole))
      .replace(/&#x([0-9a-f]+);/gi, (whole, code: string) => fromCodePoint(parseInt(code, 16), whole))
      // `&amp;` last would double-decode `&amp;lt;`; the named pass runs once over
      // the string, so each entity is replaced exactly once.
      .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
  );
}
