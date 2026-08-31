import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getMe,
  getStory,
  requestStoryAnalysis,
  saveAnalysisToBrief,
  type GenerationFailureCode,
  type GenerationLens,
} from "../api/client";
import { AnalysisRegister } from "../components/analysisRegister";
import { ArticleEntry } from "../components/indexArchetype";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { EmptyState, EntryList, ErrorState, PendingState, RetryableError } from "../components/uiStates";

// A failed run says so plainly (ADR-0010: never silently serve invalid
// intelligence). The wording is per failure code, because "the model cited
// something that does not exist" and "the provider is down" are different facts
// about the same empty screen.
const UNAVAILABLE: Record<GenerationFailureCode, string> = {
  provider_error: "The analysis provider did not answer.",
  unparseable_output: "The provider's answer could not be read.",
  schema_violation: "The provider answered outside the claim contract.",
  // Partial acceptance means a single bad claim is dropped rather than fatal (#54), so
  // both of these are the harder case: after dropping what could not be shown, too
  // little was left to publish. They differ in why — a citation that did not resolve
  // into this Story's evidence, or anything else.
  invalid_citations:
    "Too little of it could be traced back to this Story's evidence, so none of it was displayed.",
  below_claim_floor: "Too little of it could be published as an analysis.",
  content_changed: "The underlying reporting changed while this analysis was being written.",
};

// The first page on the Record archetype (#33): masthead, provenance ledger,
// body. Everything shaped here is shared — see components/recordArchetype.
export default function StoryDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["story", id], queryFn: () => getStory(id!), enabled: !!id });
  // Read from the same cache the shell's identity menu fills, so this costs no extra
  // request: an Admin is the one caller who has to say which Lens they are reading
  // through, because they are neither audience (ADR-0027).
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const isAdmin = me.data?.role === "admin";
  const [adminLens, setAdminLens] = useState<GenerationLens>("student_context");
  // A mutation, not a query: asking for an analysis may spend money and create a
  // run, so it happens when a reader asks and never on render. Repeating it is
  // cheap — the backend answers a second identical request with the run it already
  // has — but that is the backend's decision to make, not a reason to poll it.
  const analysis = useMutation({
    mutationFn: () => requestStoryAnalysis(id!, isAdmin ? adminLens : undefined),
  });
  const navigate = useNavigate();
  // #55: the ownership loop. Saving is creating a Brief, so it lands the reader on the
  // Brief they now own — the analysis is theirs from here, and stays as it is while
  // this Story goes on being reported.
  const save = useMutation({
    mutationFn: () => saveAnalysisToBrief(analysis.data!.id),
    onSuccess: (brief) => navigate(`/briefs/${brief.id}`),
  });

  if (query.isPending) return <PendingState>Loading Story…</PendingState>;
  // A Story that does not exist arrives here too, as the 404's own message
  // ("Story not found") in the shared error treatment.
  // ponytail: which leaves a Retry that cannot succeed. Telling a 404 apart
  // needs the status on the thrown error (api/client.ts throws bare Errors), and
  // every detail page in the app has this same branch — so it is one change
  // there and a pass over all of them, not two pages' worth here.
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load Story: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const story = query.data;
  const produced = analysis.data;
  const completed = produced?.status === "completed";

  return (
    <main>
      <RecordMasthead
        folio="Story"
        back={{ to: "/stories", label: "Back to Stories" }}
        title={story.title}
        dek={story.summary}
        // The coverage window is two facts, not one: when this Story was first
        // registered, and when it last moved.
        ledger={[
          { term: "Category", value: story.category },
          {
            term: "Coverage",
            value: `${story.articleCount} article${story.articleCount === 1 ? "" : "s"}`,
          },
          {
            term: "First seen",
            value: <time dateTime={story.firstSeenAt}>{new Date(story.firstSeenAt).toLocaleDateString()}</time>,
          },
          {
            term: "Last seen",
            value: <time dateTime={story.lastSeenAt}>{new Date(story.lastSeenAt).toLocaleDateString()}</time>,
          },
        ]}
      />

      {/* The flagship, on the record it analyses (#53). Above the Articles, because
          the analysis is what a reader came for and the Articles are what it cites. */}
      <RecordSection heading="Analysis">
        {!completed && (
          <>
            <p className="record-prose">
              An analysis compares how these outlets reported this story. Every claim it makes cites the
              reporting behind it, and any claim that cannot be traced back to this Story's evidence is
              never shown.
            </p>
            <div className="record-actions">
              {/* The one control an Admin needs and a reader must not have: a Lens is
                  the reader's role, so offering it to a Student would be offering to
                  read as somebody else. */}
              {isAdmin && (
                <label className="filter-field">
                  Lens
                  <select value={adminLens} onChange={(event) => setAdminLens(event.target.value as GenerationLens)}>
                    <option value="student_context">Student context</option>
                    <option value="investor_implication">Investor implication</option>
                  </select>
                </label>
              )}
              <button
                type="button"
                className="record-command"
                onClick={() => analysis.mutate()}
                disabled={analysis.isPending}
              >
                {analysis.isPending ? "Analysing…" : produced || analysis.isError ? "Try again" : "Request analysis"}
              </button>
            </div>
          </>
        )}
        {analysis.isPending && <PendingState>Selecting evidence and writing claims…</PendingState>}
        {analysis.isError && (
          <ErrorState>Could not analyse this Story: {(analysis.error as Error).message}</ErrorState>
        )}
        {produced?.status === "failed" && (
          <ErrorState>
            <p>This analysis is unavailable. {UNAVAILABLE[produced.failureCode ?? "provider_error"]}</p>
          </ErrorState>
        )}
        {completed &&
          (produced.claims.length === 0 ? (
            <EmptyState>This analysis produced no claims that could be cited.</EmptyState>
          ) : (
            <>
              <AnalysisRegister analysis={produced} />
              {/* Offered to the two roles that own Briefs, and to nobody else: an
                  Admin owns no artefacts (ADR-0004), so the API refuses them this
                  exactly as it refuses them a Brief. Waits for the identity to
                  resolve rather than assuming a reader — an Admin should never see a
                  command that would 403. */}
              {me.data && !isAdmin && (
                <div className="record-actions">
                  <button
                    type="button"
                    className="record-command"
                    onClick={() => save.mutate()}
                    disabled={save.isPending}
                  >
                    {save.isPending ? "Saving…" : "Save to a new Brief"}
                  </button>
                </div>
              )}
              {save.isError && (
                <ErrorState>Could not save this analysis: {(save.error as Error).message}</ErrorState>
              )}
            </>
          ))}
      </RecordSection>

      <RecordSection heading="Articles">
        {story.articles.length === 0 ? (
          <EmptyState>No Articles yet.</EmptyState>
        ) : (
          // The index's entry, not a second list vocabulary: an Article listed
          // under its Story is the same kind of row as one listed anywhere else,
          // and its Publisher and date belong in the same provenance register.
          // No pagination here — a Story's Articles arrive whole.
          <EntryList>
            {story.articles.map((article) => (
              <ArticleEntry key={article.id} article={article} />
            ))}
          </EntryList>
        )}
      </RecordSection>
    </main>
  );
}
