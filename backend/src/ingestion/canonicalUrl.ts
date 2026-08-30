// ADR-0024: canonical URL is the identity key for the enrichment path — two
// connectors finding the same document must land on the same string, or one
// document becomes two Articles. Normalization is therefore a correctness
// concern, not tidiness.

// Denylist, not an allowlist: a query parameter is usually load-bearing (an
// article id, a page number), so dropping everything unrecognised would collapse
// distinct documents into one — a far worse failure than keeping a stray tracker.
// `utm_*` is the universal convention and `at_*` is what the BBC's own feeds
// emit; the rest are the named trackers seen on real feed links.
// ponytail: hand-maintained denylist, so a new tracker splits one document into
// two Articles until it is added here. The upgrade path is honouring each page's
// own <link rel="canonical">, which needs the page body — i.e. Readability (#47).
const TRACKING_PARAM_PREFIXES = ["utm_", "at_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "cmpid",
  "ncid",
  "ito",
  "sh",
  "smid",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Returns null for anything that is not an absolute http(s) URL — a feed is
// untrusted input, and a relative or `javascript:` href is a rejected item
// rather than a row with a nonsense identity.
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  // A fragment addresses a position within one document, never a second
  // document — and feeds append them (`...#0`) as cache-busters.
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  // `new URL` already drops the default port and lowercases the protocol.
  //
  // Deliberately NOT stripping `www.`: this string is also the outbound link an
  // Article is read through, and an apex host is not guaranteed to serve what
  // `www` serves. Host aliasing is a Publisher-identity question, which
  // publisherDomain below answers instead.

  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }
  // Sorted so `?a=1&b=2` and `?b=2&a=1` are one document. Order carries no
  // meaning to any server that parses a query string, so this cannot break the
  // link the way host rewriting could.
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
}

// The domain a Publisher is keyed on, derived from an Article's canonical URL.
// `www.` is a hosting convention rather than an identity — one publisher must not
// become two rows because two feeds disagree about the prefix — and unlike the
// canonical URL, nothing navigates to this value, so rewriting it is safe.
export function publisherDomain(canonicalUrl: string): string {
  return new URL(canonicalUrl).hostname.replace(/^www\./, "");
}

// Duplicate matching (CONTEXT.md "Duplicate") compares titles, and publishers
// re-punctuate the same headline across feeds — curly quotes, an em dash where
// another used a hyphen. Comparison is on letters and digits alone.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
