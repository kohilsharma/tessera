import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

// ADR-0018's fourth surface (#47): the body of a page an RSS feed only teased.
// `@mozilla/readability` is the ADR's named choice and is the algorithm Firefox
// Reader View ships — a hand-rolled tag scan over a hostile, ad-laden,
// consent-walled page is the flimsier option at any size.
//
// It needs a DOM, and `linkedom` supplies one in a single dependency with no
// native build, against jsdom's much larger tree. Nothing here needs a layout
// engine, script execution or a network-aware document: Readability walks nodes
// and reads text. Only `textContent` is kept, so the relative-URL rewriting a
// real base URI would enable is not something this path uses.
//
// Measured live 2026-08-31: an NPR page yields 4.1k characters of article; a
// paywalled WSJ page yields the ~800 characters served before the wall, which is
// real reporting rather than a "subscribe" stub. So `api_content` means the body
// as the page served an anonymous reader, not a guarantee of the whole article —
// which is exactly why ADR-0024 keeps it a rung below `licensed_full_text` and why
// Phase-3 wording must respect the weakest mode in an EvidenceSet.

// Below this, an "extraction" is a consent notice, a paywall stub or a nav
// skeleton rather than reporting — and a body weaker than the feed excerpt it
// replaces is worse than no extraction at all, because the ladder makes the swap
// irreversible (ADR-0024). Roughly two paragraphs.
//
// ponytail: length as a proxy for "is this reporting", so a genuinely short wire
// brief is read as a consent wall and, since the attempt is marked either way, is
// never re-read. The upgrade path is Readability's own confidence signals
// (paragraph count, link density) in place of the floor.
export const MIN_EXTRACTED_TEXT_LENGTH = 600;

// Null rather than throwing for a page Readability cannot read: failure is the
// expected outcome on a paywall, and the caller counts it the same either way.
export function extractArticleText(html: string): string | null {
  const { document } = parseHTML(html);
  const parsed = new Readability(document).parse();
  // Whitespace collapsed for the reason the RSS parser collapses it: analysisText
  // feeds tsvector and, later, evidence text, and a page's indentation is noise a
  // human reader would never have seen.
  const text = parsed?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length >= MIN_EXTRACTED_TEXT_LENGTH ? text : null;
}
