import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getArticle, type AnalysisTextMode } from "../api/client";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { PendingState, RetryableError } from "../components/uiStates";
import { Leaning, LeaningAttribution } from "../components/primitives";
import leaningStyles from "../components/primitives.module.css";

// CONTEXT.md's Analysis Text Mode, said in words. The raw enum member is the
// backend's vocabulary, not a statement a reader can act on: `held` completes
// "Tessera holds …" so the mode says what text actually exists here, which is
// the point of stating it at all.
const ANALYSIS_TEXT_MODES: Record<AnalysisTextMode, { label: string; held: string }> = {
  metadata_only: { label: "Metadata only", held: "the title and source metadata, with no analysable article text" },
  feed_excerpt: { label: "Feed excerpt", held: "the headline and excerpt from this Publisher's feed" },
  // Not "API content", whatever the rung is called in the ladder: since #47 this
  // text comes from Extraction reading the Publisher's own page, and no API ever
  // served it. The rung keeps its name in CONTEXT.md; the reader gets the truth.
  api_content: {
    label: "Extracted text",
    held: "the article body read from this Publisher's own page, where the feed carried only an excerpt",
  },
  licensed_full_text: { label: "Licensed full text", held: "the full article text, under a partner licence" },
  manual_fixture: { label: "Manual fixture", held: "seeded demonstration text, not live coverage" },
};

// A mode the backend has and this page has not is a fact about the record, so it
// is shown, not swallowed: a page that throws states nothing at all.
function describeMode(mode: string) {
  return (
    ANALYSIS_TEXT_MODES[mode as AnalysisTextMode] ?? { label: mode, held: "text under a mode this page does not yet describe" }
  );
}

export default function ArticleDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["article", id], queryFn: () => getArticle(id!), enabled: !!id });

  if (query.isPending) return <PendingState>Loading Article…</PendingState>;
  // As on Story detail, a missing Article arrives as the 404's own message in
  // the shared error treatment — see the ponytail note there.
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load Article: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const article = query.data;
  const mode = describeMode(article.analysisTextMode);

  return (
    <main>
      <RecordMasthead
        folio="Article"
        // An Article's parent list is its Story, not the Stories index: that is
        // where the reader came from and where its siblings are.
        back={{ to: `/stories/${article.story.id}`, label: `Back to ${article.story.title}` }}
        title={article.title}
        ledger={[
          { term: "Publisher", value: article.publisher.name },
          {
            term: "Published",
            value: <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString()}</time>,
          },
          // Stated in the ledger, not buried in the body: what text Tessera
          // holds is a fact about the record, and it governs how much of the
          // section below is even there to read.
          { term: "Analysis Text Mode", value: mode.label },
        ]}
      />

      <RecordSection heading="Analysis text">
        {article.analysisText ? (
          <p className="record-prose">{article.analysisText}</p>
        ) : article.analysisTextMode === "metadata_only" ? (
          <p className="record-prose">
            No analysable article text is available. Read the reporting at the original source below.
          </p>
        ) : (
          <p className="record-prose">
            This Article&rsquo;s text is held for analysis only and is not shown here. Read it at the
            original source below.
          </p>
        )}
      </RecordSection>

      {/* ADR-0032, as a part of the record rather than a footnote under it: what
          Tessera holds, whether this Publisher's terms let the reader read it,
          and where the original is. The body being shown or withheld is the one
          fact a reader cannot work out for themselves, so it is stated. */}
      <RecordSection heading="Rights and provenance">
        <dl className="record-note">
          <div>
            <dt>Text held</dt>
            <dd>
              Tessera holds {mode.held} ({mode.label}).
            </dd>
          </div>
          <div>
            <dt>Terms Class</dt>
            <dd>
              {/* The same three cases the section above reads, said as the rule
                  behind them: `analysisText` is absent exactly where this
                  Publisher's Terms Class refuses to serve it (ADR-0032).
                  Attributed to Tessera, not to the Publisher — the class is our
                  classification over a default, and putting a licence claim in a
                  publisher's mouth is a verdict this product cannot support. */}
              {article.analysisTextMode === "metadata_only"
                ? "No article body is held; Publisher, title, date, and link are open metadata."
                : article.analysisText
                  ? "Tessera classifies this Publisher's text as cleared to show, so the body above is the reporting as Tessera holds it. Publisher, title, date, and link are open metadata."
                  : "Tessera does not classify this Publisher's text as cleared to show, so the body stays inside Tessera for analysis and appears on no page. Publisher, title, date, and link are open metadata."}
            </dd>
          </div>
          {/* CONTEXT.md "Publisher Leaning" (#85). It belongs in this register and
              nowhere else on the page: like the Terms Class above it, it is a
              statement about the *source* rather than about this article, and the
              register is where the reader already comes to ask who is speaking.
              The rating is reproduced, never computed — which is what lets a
              product built on "no claim without a citation" show one at all. */}
          <div>
            <dt>Publisher leaning</dt>
            <dd>
              <Leaning leaning={article.publisherLeaning} />
              <p className={leaningStyles.leaningNote}>
                {article.publisherLeaning
                  ? `Published by ${article.publisherLeaning.source.name} and shown in their words. Tessera reproduces third-party ratings and rates no publisher itself.`
                  : `No third-party rating has been published for ${article.publisher.name}. Tessera reproduces ratings rather than making them, so it states none here instead of inferring one.`}
              </p>
              <LeaningAttribution
                sources={article.publisherLeaning ? [article.publisherLeaning.source] : []}
              />
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <a href={article.url} target="_blank" rel="noreferrer">
                Read the original at {article.publisher.domain}
              </a>
            </dd>
          </div>
        </dl>
      </RecordSection>
    </main>
  );
}
