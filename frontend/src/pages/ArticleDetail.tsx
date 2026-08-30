import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getArticle, type AnalysisTextMode } from "../api/client";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { PendingState, RetryableError } from "../components/uiStates";

// CONTEXT.md's Analysis Text Mode, said in words. The raw enum member is the
// backend's vocabulary, not a statement a reader can act on: `held` completes
// "Tessera holds …" so the mode says what text actually exists here, which is
// the point of stating it at all.
const ANALYSIS_TEXT_MODES: Record<AnalysisTextMode, { label: string; held: string }> = {
  metadata_only: { label: "Metadata only", held: "the title and source metadata, with no analysable article text" },
  feed_excerpt: { label: "Feed excerpt", held: "the headline and excerpt from this Publisher's feed" },
  api_content: { label: "API content", held: "the article text served by the GDELT DOC API" },
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

      {/* ADR-0018, as a part of the record rather than a footnote under it:
          Publisher metadata is open, the body is not, and the reader is told
          which of the two they are looking at. */}
      <RecordSection heading="Rights and provenance">
        <dl className="record-note">
          <div>
            <dt>Text held</dt>
            <dd>
              Tessera holds {mode.held} ({mode.label}).
            </dd>
          </div>
          <div>
            <dt>Redistribution</dt>
            <dd>
              {article.analysisTextMode === "metadata_only"
                ? "No article body is held; Publisher, title, date, and link are open metadata."
                : "Body text is held inside Tessera for analysis and is never redistributed or republished. Publisher, title, date, and link are open metadata."}
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
