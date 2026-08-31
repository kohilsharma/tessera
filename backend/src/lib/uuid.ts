const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Takes `unknown` so a request body can be checked with it directly (#52): a
// caller-supplied field is only a string once something has said so, and a type
// guard says it in the type system rather than in a cast at the call site.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
