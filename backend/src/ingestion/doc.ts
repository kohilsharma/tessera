import { parseGdeltStamp } from "./gkg";

// GDELT DOC 2.0 (ADR-0018): on-demand keyword and `theme:` search over roughly
// the last three months, unauthenticated, `mode=artlist&format=json`. Where GKG
// is a firehose on a 15-minute clock, DOC answers a *question* — so the question
// lives in the connector's `endpoint` query string. The seed owns and converges
// that endpoint today; the Admin API only controls whether the connector is enabled.
//
// An artlist record carries url, url_mobile, title, seendate, socialimage, domain,
// language and sourcecountry (verified against a live response, 2026-08-31: 250
// records, 156 distinct domains). There is **no body and no snippet**, so ADR-0024
// puts a DOC row on the same weakest rung as a GKG row: `metadata_only`, with
// genuinely null text.

// GDELT's own ceiling, not ours: a query returns at most 250 records and the API
// offers no paging cursor to walk past it. Asking for the maximum is what makes
// "we received exactly this many" a reliable signal that there were more.
export const DOC_MAX_RECORDS = 250;

export type DocArticle = {
  // Raw, not canonicalized: normalization is the run's job, so a URL is
  // canonicalized in exactly one place (the same split as rss.ts and gkg.ts).
  url: string | null;
  title: string | null;
  // When GDELT saw the document. DOC reports no publication time of its own —
  // this is the weaker of the two timestamps GKG has and the only one on offer
  // here.
  seenAt: Date | null;
};

// `domain` is deliberately not read. Unlike GKG's V2SOURCECOMMONNAME — which names
// an apex the document may be served from a subdomain of, and so carries real
// information — DOC's `domain` was the document host itself in all 250 records of
// the captured response. It is what `publisherDomain` already derives, so reading
// it would add a way for an item to fail and no way for one to succeed.

// Enough of a rejected body to recognise a throttle notice or a block page in an
// IngestionRun's errorSummary, not enough to turn that field into a log file.
const MAX_REPORTED_BODY = 200;

function snippet(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_REPORTED_BODY ? `${collapsed.slice(0, MAX_REPORTED_BODY)}…` : collapsed;
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// The endpoint carries `query`, `timespan`, `sort` and the rest; the output shape
// and record cap are connector-owned because the parser below only reads one shape
// and the truncation check only means something at the maximum.
export function docRequestUrl(endpoint: string): string {
  const url = new URL(endpoint);
  // A DOC connector with no query is a misconfiguration, not an empty search, and
  // refusing here names it — GDELT's own answer to a query-less request is an error
  // body the run would otherwise have to relay.
  if (!textOf(url.searchParams.get("query"))) {
    throw new Error(`DOC connector endpoint carries no "query" parameter: ${endpoint}`);
  }
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(DOC_MAX_RECORDS));
  return url.toString();
}

function toDocArticle(raw: unknown): DocArticle {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const title = textOf(record.title);
  const seendate = textOf(record.seendate);
  return {
    url: textOf(record.url),
    // GDELT tokenizes titles, so `Not Nvidia . Not AMD .` is the real surface
    // form. Only the whitespace tokenization leaves behind is collapsed —
    // guessing which spaces were not in the headline is guessing, and
    // `normalizeTitle` already ignores punctuation when matching duplicates.
    title: title === null ? null : title.replace(/\s+/g, " "),
    // `20260830T211500Z` — the same 14 UTC digits GKG stamps, with separators.
    seenAt: parseGdeltStamp(seendate === null ? null : seendate.replace(/\D/g, "")),
  };
}

// Throws for a body that is not JSON at all, which is how a throttled or blocked
// caller finds out: GDELT answers those with a 200 and its own plain-text notice
// ("Please limit requests to one every 5 seconds…", measured 2026-09-01) or a block
// page, rather than a status code. Every record inside a well-formed response yields
// a DocArticle, including a mutilated one, so a bad record fails *that item* exactly
// as a bad feed entry does.
export function parseDocArtList(body: string): DocArticle[] {
  if (body.trim() === "") throw new Error("GDELT DOC API returned an empty body");
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`GDELT DOC API returned a non-JSON body: ${snippet(body)}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`GDELT DOC API returned no artlist object: ${snippet(body)}`);
  }
  const articles = (payload as { articles?: unknown }).articles;
  // A missing `articles` key is GDELT's way of saying nothing matched — measured
  // 2026-09-01 (#60) both for a nonsense query over a day-wide window and for the
  // seeded query over the newest hour, which GDELT has not finished indexing. It
  // used to be read as a block signal; that was wrong, and reading it that way
  // failed every DOC run whose window happened to be empty. Refusal arrives as a
  // non-JSON body (above), which still fails loudly, so nothing is lost silently.
  if (articles === undefined) return [];
  if (!Array.isArray(articles)) {
    throw new Error(`GDELT DOC API returned a non-array "articles": ${snippet(body)}`);
  }
  return articles.map(toDocArticle);
}
