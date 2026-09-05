import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  GENERATION_LENSES,
  getMe,
  getBriefs,
  getStories,
  getStory,
  getStoryAnalysis,
  getStoryTimeline,
  LENS_LABELS,
  requestStoryAnalysis,
  requestStoryMarketRead,
  addToWatchlist,
  makeFlashcards,
  mergeStories,
  unmergeStory,
  saveAnalysisToBrief,
  updateBrief,
  type BriefSummary,
  type GenerationFailureCode,
  type GenerationLens,
  type StoryAnalysis,
  type StoryDetail as StoryDetailData,
} from "../api/client";
import { AnalysisRegister } from "../components/analysisRegister";
import { ArticleEntry } from "../components/indexArchetype";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { TimelineRegister } from "../components/timelineRegister";
import { EmptyState, EntryList, ErrorState, PendingState, RetryableError } from "../components/uiStates";
import { CoverageSpectrum, RolePanel, SelectField } from "../components/primitives";
import { InvestorMarketPanel } from "../components/marketPanel";
import { Cards, GitMerge, Plus } from "@phosphor-icons/react";
import styles from "./StoryDetail.module.css";

function StudentStoryPanel({
  story,
  analysis,
}: {
  story: StoryDetailData;
  analysis: StoryAnalysis | undefined;
}) {
  const cards = useMutation({ mutationFn: () => makeFlashcards(analysis!.id) });
  return (
    <RolePanel role="Student">
      <div className={styles.roleHeading}><div><h3>Study this Story</h3><p>{story.studentPanel?.collectionCount ?? 0} Brief{story.studentPanel?.collectionCount === 1 ? "" : "s"} saved</p></div><Cards aria-hidden size={24} weight="duotone" /></div>
      {analysis?.status === "completed" ? (
        <div className="record-actions">
          <button type="button" className="record-command" onClick={() => cards.mutate()} disabled={cards.isPending}><Cards aria-hidden size={18} /> {cards.isPending ? "Making cards…" : "Make flashcards"}</button>
        </div>
      ) : <p className="record-prose">Request an analysis below to make cited Flashcards or save this Story in a Brief.</p>}
      {cards.isError && <ErrorState>Could not make flashcards: {(cards.error as Error).message}</ErrorState>}
      {cards.isSuccess && <p role="status">Cards added to your deck.</p>}
    </RolePanel>
  );
}

function AnalysisSaveControl({
  generationRunId,
  label,
  emptyLabel,
}: {
  generationRunId: string;
  label: string;
  emptyLabel: string;
}) {
  const navigate = useNavigate();
  const [targetBriefId, setTargetBriefId] = useState("");
  const briefs = useQuery({
    queryKey: ["briefs", "analysis-save-picker"],
    queryFn: async () => {
      const first = await getBriefs({ page: 1, pageSize: 50, sort: "updatedAt:desc" });
      if (!Array.isArray(first.items)) return [];
      if (!Number.isInteger(first.totalPages) || first.totalPages <= 1) return first.items;
      const rest = await Promise.all(
        Array.from({ length: first.totalPages - 1 }, (_, index) =>
          getBriefs({ page: index + 2, pageSize: 50, sort: "updatedAt:desc" }),
        ),
      );
      return [first, ...rest].flatMap((page) => page.items);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      targetBriefId
        ? updateBrief(targetBriefId, { generationRunId })
        : saveAnalysisToBrief(generationRunId),
    onSuccess: (brief) => navigate(`/briefs/${brief.id}`),
  });
  const options: BriefSummary[] = Array.isArray(briefs.data) ? briefs.data : [];

  return (
    <>
      {briefs.isPending && <PendingState>Loading your Briefs…</PendingState>}
      {briefs.isError && (
        <RetryableError
          message={`Could not load your Briefs: ${(briefs.error as Error).message}`}
          onRetry={() => briefs.refetch()}
          retrying={briefs.isFetching}
        />
      )}
      <SelectField
        label={label}
        value={targetBriefId}
        onChange={(event) => setTargetBriefId(event.target.value)}
        disabled={briefs.isPending || briefs.isError || save.isPending}
      >
          <option value="">{emptyLabel}</option>
          {options.map((brief) => (
            <option key={brief.id} value={brief.id}>
              {brief.title} ({brief.articleCount}/{brief.articleCapacityLimit})
            </option>
          ))}
      </SelectField>
      <button type="button" className="record-command" onClick={() => save.mutate()} disabled={save.isPending}>
        <Plus aria-hidden size={18} /> {save.isPending ? "Saving…" : targetBriefId ? "Save to Brief" : emptyLabel}
      </button>
      {save.isError && <ErrorState>Could not save this analysis: {(save.error as Error).message}</ErrorState>}
    </>
  );
}

function AdminStoryPanel({ story, storyId, onRefresh }: { story: NonNullable<StoryDetailData["adminPanel"]>; storyId: string; onRefresh: () => void }) {
  const candidates = useQuery({ queryKey: ["story-merge-picker", storyId], queryFn: () => getStories({ pageSize: 50, sort: "firstSeenAt:desc" }) });
  const [mergedStoryId, setMergedStoryId] = useState("");
  const merge = useMutation({ mutationFn: () => mergeStories(storyId, mergedStoryId), onSuccess: onRefresh });
  const unmerge = useMutation({ mutationFn: (mergeId: string) => unmergeStory(mergeId), onSuccess: onRefresh });
  return (
    <RolePanel role="Admin">
      <div className={styles.roleHeading}><div><h3>Record controls</h3><p>Pipeline provenance and Story corrections.</p></div><GitMerge aria-hidden size={24} weight="duotone" /></div>
      <dl className={styles.adminLedger}>
        <div><dt>Clustering run</dt><dd>{story.clusteringRun ? `${story.clusteringRun.status} · ${new Date(story.clusteringRun.startedAt).toLocaleString()}` : "Not assembled by a recorded run"}</dd></div>
        <div><dt>Analysis prompt</dt><dd>{story.latestAnalysis ? `${story.latestAnalysis.promptVersion} · ${story.latestAnalysis.lens}` : "No analysis run yet"}</dd></div>
      </dl>
      <div className="record-actions">
        <label className="filter-field">Merge another Story <select value={mergedStoryId} onChange={(event) => setMergedStoryId(event.target.value)}><option value="">Choose a Story</option>{candidates.data?.items.filter((candidate) => candidate.id !== storyId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>
        <button type="button" className="record-command" onClick={() => merge.mutate()} disabled={!mergedStoryId || merge.isPending}><GitMerge aria-hidden size={18} /> {merge.isPending ? "Merging…" : "Merge"}</button>
      </div>
      {candidates.data && <p className="record-prose">Showing {candidates.data.items.length} of {candidates.data.total} Stories available to merge.</p>}
      {merge.isError && <ErrorState>Could not merge this Story: {(merge.error as Error).message}</ErrorState>}
      {story.mergeHistory.length > 0 && <><p className="record-prose">Showing {story.mergeHistory.length} of {story.mergeHistoryTotal} previous merges.</p><ul className={styles.mergeHistory}>{story.mergeHistory.map((item) => <li key={item.id}><span>{item.mergedStory.title}</span><button type="button" onClick={() => unmerge.mutate(item.id)} disabled={unmerge.isPending}>Unmerge</button></li>)}</ul></>}
      {unmerge.isError && <ErrorState>Could not unmerge this Story: {(unmerge.error as Error).message}</ErrorState>}
    </RolePanel>
  );
}

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
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["story", id], queryFn: () => getStory(id!), enabled: !!id });
  // Read from the same cache the shell's identity menu fills, so this costs no extra
  // request: an Admin is the one caller who has to say which Lens they are reading
  // through, because they are neither audience (ADR-0027).
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  // A fetch on render, unlike the analysis above it: a timeline is computed from rows
  // that already exist (ADR-0020), so reading one spends nothing and creates nothing.
  // Its own request, so this register owns its own four states — the Story loading and
  // the timeline loading are two different waits.
  const timeline = useQuery({
    queryKey: ["story-timeline", id],
    queryFn: () => getStoryTimeline(id!),
    enabled: !!id,
  });
  const isAdmin = me.data?.role === "admin";
  const [adminLens, setAdminLens] = useState<GenerationLens>("student_context");
  const analysisKey = ["story-analysis", id, isAdmin ? adminLens : me.data?.role];
  const existingAnalysis = useQuery({
    queryKey: analysisKey,
    queryFn: () => getStoryAnalysis(id!, isAdmin ? adminLens : undefined),
    enabled: !!id && ["student", "investor", "admin"].includes(me.data?.role ?? ""),
  });
  // A mutation, not a query: asking for an analysis may spend money and create a
  // run, so it happens when a reader asks and never on render. Repeating it is
  // cheap — the backend answers a second identical request with the run it already
  // has — but that is the backend's decision to make, not a reason to poll it.
  const analysis = useMutation({
    mutationFn: () => requestStoryAnalysis(id!, isAdmin ? adminLens : undefined),
    onSuccess: (data) => queryClient.setQueryData(analysisKey, data),
  });
  const produced = analysis.data && (!isAdmin || analysis.data.lens === adminLens)
    ? analysis.data
    : existingAnalysis.data ?? undefined;
  const navigate = useNavigate();
  // #55: the ownership loop. Saving lands the reader on the Brief they chose or created;
  // the analysis is theirs from here, and stays as it is while this Story is reported.
  const marketRead = useMutation({ mutationFn: () => requestStoryMarketRead(id!) });
  const watchlist = useMutation({ mutationFn: (ticker: string) => addToWatchlist({ kind: "ticker", value: ticker }) });

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

      <RecordSection heading="Coverage spectrum">
        <CoverageSpectrum spectrum={story.coverageSpectrum} />
      </RecordSection>

      {me.data?.role === "student" && <RecordSection heading="Your desk"><StudentStoryPanel story={story} analysis={produced} /></RecordSection>}
      {me.data?.role === "admin" && story.adminPanel && <RecordSection heading="Operator panel"><AdminStoryPanel story={story.adminPanel} storyId={story.id} onRefresh={() => query.refetch()} /></RecordSection>}

      {me.data?.role === "investor" && (
        <RecordSection heading="Market intelligence">
          <InvestorMarketPanel
            markets={story.market}
            status={story.marketStatus}
            total={story.marketTotal}
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
            read={marketRead.data?.marketRead}
            onGenerateRead={() => marketRead.mutate()}
            generatingRead={marketRead.isPending}
            readError={marketRead.error as Error | null}
            onAddWatchlist={(ticker) => watchlist.mutate(ticker)}
            addingWatchlist={watchlist.isPending}
          />
          {watchlist.isError && <ErrorState>Could not add this Ticker to your watchlist: {(watchlist.error as Error).message}</ErrorState>}
          {watchlist.isSuccess && <p role="status">Ticker added to your watchlist.</p>}
        </RecordSection>
      )}

      {/* The flagship, on the record it analyses (#53). Above the Articles, because
          the analysis is what a reader came for and the Articles are what it cites. */}
      <RecordSection heading="Analysis">
        {existingAnalysis.isPending && !analysis.isPending && <PendingState>Checking for an existing analysis…</PendingState>}
        {existingAnalysis.isError && (
          <ErrorState>Could not load this Story's existing analysis: {(existingAnalysis.error as Error).message}</ErrorState>
        )}
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
                    {GENERATION_LENSES.map((lens) => (
                      <option key={lens} value={lens}>
                        {LENS_LABELS[lens]}
                      </option>
                    ))}
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
              {produced.reused && <p role="status">This analysis was reused; it was not regenerated.</p>}
              {/* Offered to the two roles that own Briefs, and to nobody else: an
                  Admin owns no artefacts (ADR-0004), so the API refuses them this
                  exactly as it refuses them a Brief. Waits for the identity to
                  resolve rather than assuming a reader — an Admin should never see a
                  command that would 403. */}
              {me.data && ["student", "investor"].includes(me.data.role) && (
                <div className="record-actions">
                  <AnalysisSaveControl generationRunId={produced.id} label="Save analysis to" emptyLabel="Save to a new Brief" />
                </div>
              )}
            </>
          ))}
      </RecordSection>

      {/* #64: the record's one coverage register. It is the Articles list #33 shipped —
          same rows, same provenance, same link into each Article — ordered against the
          analysis this Story has been through, so keeping a second register of the same
          rows beside it would be listing the Story's reporting twice. */}
      <RecordSection heading="Timeline">
        {timeline.isPending && <PendingState>Assembling this Story's timeline…</PendingState>}
        {timeline.isError && (
          <>
            <RetryableError
              message={`Could not load this Story's timeline: ${(timeline.error as Error).message}`}
              onRetry={() => timeline.refetch()}
              retrying={timeline.isFetching}
            />
            {/* The coverage list is on the record this page already loaded, so a second
                request failing costs the reader the ordering and the events — never the
                reporting itself. */}
            <EntryList>
              {story.articles.map((article) => (
                <ArticleEntry key={article.id} article={article} />
              ))}
            </EntryList>
          </>
        )}
        {/* Empty is a fact about the Story, not a failure of the request: a Story with
            nothing datable on it has nothing to put on an axis. Both halves are tested,
            because a Story can hold analytical events with no accepted members left — a
            merge (#52) moves members and repoints the runs — and telling that reader
            there is nothing would be saying so while the API returned events. */}
        {timeline.data &&
          (timeline.data.points.length === 0 && timeline.data.events.length === 0 ? (
            <EmptyState>This Story has no datable reporting yet.</EmptyState>
          ) : (
            <TimelineRegister timeline={timeline.data} />
          ))}
      </RecordSection>
    </main>
  );
}
