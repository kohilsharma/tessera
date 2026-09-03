import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createPromptTemplate,
  decideMergeProposal,
  decidePendingAssignment,
  getMergeProposals,
  getPendingAssignments,
  getStories,
  mergeStories,
  runClustering,
  runEntityResolution,
  setPromptTemplateCurrent,
  CORE_CLAIM_TYPES,
  ENTITY_KIND_LABELS,
  type AssignmentDecision,
  type ClusteringRunSummary,
  type CoreClaimType,
  type EntityResolutionRunSummary,
  type IngestionRunSummary,
  type MergeProposalDecision,
  type MergeProposalSide,
  type PromptTemplateSummary,
} from "../api/client";
import { GraphLedger } from "../components/graphRegister";
import { DateStamp } from "../components/indexArchetype";
import { DashboardRegister, RegisterRow } from "../components/dashboardArchetype";
import { EmptyState, EntryList, ErrorState, PendingState, RetryableError } from "../components/uiStates";

// The operator registers Phase 3 added, each one its own component beside the console
// that lays them out (#49, #50, #52, #57, #66, #67). They are here rather than in
// AdminDashboard because each has its own reason to change — a clustering ledger, two
// review queues, a merge form, a prompt-tuning form — and a console that had to be edited
// for all of them was one file with six unrelated futures.
//
// Each owns its own requests and its own commands, so a refusal is stated where it
// happened and cannot outlive the register it belongs to. The three that fetch (the two
// review queues and the merge picker) begin their requests when the console has rendered,
// since that is when they mount — one round trip after the payload rather than beside it,
// which is the price of each register stating its own four states.

// A run's own timing, in the note line rather than the ledger: a timestamp and a
// duration are one fact about when, and two more ledger cells beside seven counters
// would be the widest register on the surface holding the least. Shared by all three
// run registers, which read the same way — hence the two fields it uses rather than a
// union of the three run types, which would have to be widened for a fourth.
export function runTiming(run: { startedAt: string; completedAt: string | null }): string {
  const started = new Date(run.startedAt);
  if (!run.completedAt) return `${started.toLocaleString()} · in flight`;
  const seconds = (new Date(run.completedAt).getTime() - started.getTime()) / 1000;
  return `${started.toLocaleString()} · ${seconds.toFixed(1)}s`;
}

export const RUN_STATUS_LABEL: Record<IngestionRunSummary["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

// Every command here changes what the console payload says, so every one refetches it.
function useConsoleRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
}

// #49: the clustering pass, which turns Unclustered Articles into Stories. Its command
// sits on the register rather than on a row, because there is one pass over the whole
// corpus and nothing to name. ADR-0026: history is read from Postgres, so this register
// renders whether or not the worker is running.
export function ClusteringRunsRegister({ runs }: { runs: ClusteringRunSummary[] }) {
  const refresh = useConsoleRefresh();
  const cluster = useMutation({ mutationFn: runClustering, onSuccess: refresh });

  return (
    <DashboardRegister
      heading="Clustering runs"
      folio={`${runs.length} most recent`}
      command={
        <button type="button" disabled={cluster.isPending} onClick={() => cluster.mutate()}>
          {cluster.isPending ? "Queueing…" : "Run clustering"}
        </button>
      }
    >
      {cluster.error && <ErrorState>{cluster.error.message}</ErrorState>}
      {cluster.isSuccess && (
        <PendingState>
          Clustering queued. The pass runs hourly; a queued run appears below once the worker has executed it — start
          it with <code>npm run worker</code> in <code>backend/</code>.
        </PendingState>
      )}
      {runs.length === 0 ? (
        <EmptyState>
          <p>
            Clustering has not run yet. Until it does, ingested reporting stays Unclustered — held, but invisible to
            browse and search.
          </p>
        </EmptyState>
      ) : (
        <EntryList>
          {runs.map((clusteringRun) => (
            <RegisterRow
              key={clusteringRun.id}
              name={`Clustering pass · ${RUN_STATUS_LABEL[clusteringRun.status]}`}
              note={`${runTiming(clusteringRun)}${
                clusteringRun.errorSummary ? ` · ${clusteringRun.errorSummary}` : ""
              }`}
              meta={[
                { term: "Embedded", value: clusteringRun.embedded },
                { term: "Considered", value: clusteringRun.considered },
                { term: "Assigned", value: clusteringRun.assigned },
                { term: "Held", value: clusteringRun.heldForReview },
                { term: "Seeded", value: clusteringRun.seeded },
                { term: "New Stories", value: clusteringRun.storiesCreated },
                { term: "Unclustered", value: clusteringRun.unclustered },
              ]}
            />
          ))}
        </EntryList>
      )}
    </DashboardRegister>
  );
}

// #66: the entity resolution pass, which promotes the surface names GKG staged into
// Entities and rebuilds their cited co-occurrence edges. Its command sits on the
// register for the reason clustering's does — one pass over everything, so there is no
// row to hang it on — and its history is read from Postgres, so this renders with the
// worker stopped.
export function EntityResolutionRunsRegister({ runs }: { runs: EntityResolutionRunSummary[] }) {
  const refresh = useConsoleRefresh();
  const resolve = useMutation({ mutationFn: runEntityResolution, onSuccess: refresh });

  return (
    <DashboardRegister
      heading="Entity resolution runs"
      folio={`${runs.length} most recent`}
      command={
        <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
          {resolve.isPending ? "Queueing…" : "Run resolution"}
        </button>
      }
    >
      {resolve.error && <ErrorState>{resolve.error.message}</ErrorState>}
      {resolve.isSuccess && (
        <PendingState>
          Entity resolution queued. The pass runs hourly; a queued run appears below once the worker has executed it —
          start it with <code>npm run worker</code> in <code>backend/</code>.
        </PendingState>
      )}
      {runs.length === 0 ? (
        <EmptyState>
          <p>
            Entity resolution has not run yet. The GKG Annotations behind the graph are staged against their Articles,
            but no name has been promoted, so there is nothing to read yet.
          </p>
        </EmptyState>
      ) : (
        <EntryList>
          {runs.map((resolutionRun) => (
            <RegisterRow
              key={resolutionRun.id}
              name={`Resolution pass · ${RUN_STATUS_LABEL[resolutionRun.status]}`}
              note={`${runTiming(resolutionRun)}${
                resolutionRun.errorSummary ? ` · ${resolutionRun.errorSummary}` : ""
              }`}
              meta={[
                { term: "Annotations", value: resolutionRun.annotationsRead },
                { term: "Articles", value: resolutionRun.articlesRead },
                { term: "Considered", value: resolutionRun.considered },
                { term: "Promoted", value: resolutionRun.promoted },
                { term: "Below floor", value: resolutionRun.belowFloor },
                { term: "Demoted", value: resolutionRun.demoted },
                // #67, and pairs rather than names: a pass that merges one pair
                // promoted both of its names first, so `Promoted 4 · Merged 1` is the
                // honest reading. Read beside the queue below, which holds what the
                // pass would not commit itself.
                { term: "Merged", value: resolutionRun.merged },
                { term: "Proposed", value: resolutionRun.proposed },
                { term: "Edges", value: resolutionRun.edgesBuilt },
              ]}
            />
          ))}
        </EntryList>
      )}
    </DashboardRegister>
  );
}

// #50: the band beneath the auto-accept threshold, as a queue rather than a ledger —
// every row is a decision only a person can make, and until they make it the Article is
// invisible to every reader. Its own request, so it states its own loading, refusal,
// empty and populated treatments inside the register.
export function ClusteringReviewRegister() {
  const refresh = useConsoleRefresh();
  const queryClient = useQueryClient();
  const review = useQuery({ queryKey: ["clustering", "pending"], queryFn: getPendingAssignments });
  // A decision changes the queue *and* the console: accepting adds a member to a Story,
  // which moves the publisher and Story counts the other registers state.
  const decide = useMutation({
    mutationFn: ({ articleId, decision }: { articleId: string; decision: AssignmentDecision }) =>
      decidePendingAssignment(articleId, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clustering", "pending"] });
      void refresh();
    },
  });

  return (
    <DashboardRegister
      heading="Clustering review"
      folio={review.data ? `${review.data.total} awaiting a decision` : "Pending Story Assignments"}
    >
      {review.isPending && <PendingState>Loading the review queue…</PendingState>}
      {review.isError && (
        <RetryableError
          message={review.error.message}
          onRetry={() => void review.refetch()}
          retrying={review.isFetching}
        />
      )}
      {decide.error && <ErrorState>{decide.error.message}</ErrorState>}
      {review.data &&
        (review.data.items.length === 0 ? (
          <EmptyState>
            <p>
              Nothing is waiting on a decision. Clustering holds an Article here when its best Story is a close call
              rather than a clear match.
            </p>
          </EmptyState>
        ) : (
          <EntryList total={review.data.total}>
            {review.data.items.map((proposal) => {
              const deciding = decide.isPending && decide.variables?.articleId === proposal.id;
              return (
                <RegisterRow
                  key={proposal.id}
                  // Not a link, unlike a Story row: a pending Article has no record
                  // page — the API refuses it for the same reason this queue exists.
                  // Its publisher and date are the row's own address instead.
                  name={proposal.title}
                  note={`${proposal.publisher.name} · ${new Date(proposal.publishedAt).toLocaleString()}`}
                  meta={[
                    { term: "Score", value: proposal.score?.toFixed(2) ?? "unscored" },
                    {
                      term: "Proposed Story",
                      // The Story *is* readable — it has accepted members — so a
                      // reviewer can open what the proposal claims this reporting
                      // belongs to before deciding.
                      value: <Link to={`/stories/${proposal.proposedStory.id}`}>{proposal.proposedStory.title}</Link>,
                    },
                    { term: "Category", value: proposal.proposedStory.category },
                  ]}
                  action={
                    <>
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => decide.mutate({ articleId: proposal.id, decision: "accept" })}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => decide.mutate({ articleId: proposal.id, decision: "reject" })}
                      >
                        Reject
                      </button>
                    </>
                  }
                />
              );
            })}
          </EntryList>
        ))}
    </DashboardRegister>
  );
}

// One side of a candidate merge: the surface name GDELT reported, what it is cited by,
// and a sample of that reporting. The analysis register's ruled pair (styles.css), which
// exists to make two sides read as two things rather than one run of links — the same
// job here, where the whole decision is whether these two stacks of reporting are about
// one thing.
//
// Each sample opens where it can actually be read, which is what the endpoint's `story`
// label decides — the same reading the neighbourhood's citation drawer takes (#69). The
// graph is firehose-derived (ADR-0028), so most of what it cites has no accepted Story
// membership and therefore no Article record: `/articles/:id` 404s exactly those rows.
// Story-backed reporting opens its record, the rest opens the original at its Publisher,
// which is the only place there is to read it.
function ProposalSide({ role, side }: { role: string; side: MergeProposalSide }) {
  return (
    <li>
      <p className="side-publisher">
        {role} · {side.canonicalName} · {side.articleCount} Article{side.articleCount === 1 ? "" : "s"}
      </p>
      {side.articles.length === 0 ? (
        // Honest rather than empty: the count above is what the pass measured over the
        // whole annotation window, and the sample is drawn from kept edges, which a name
        // at the bound's edge may have none of.
        <p className="claim-note">No kept edge behind this name, so there is nothing to sample</p>
      ) : (
        side.articles.map((article) => (
          <p key={article.id} className="side-cite">
            <span>
              <DateStamp iso={article.publishedAt} />
            </span>{" "}
            ·{" "}
            {article.story ? (
              <Link to={`/articles/${article.id}`}>{article.title}</Link>
            ) : (
              <a href={article.url} target="_blank" rel="noreferrer">
                {article.title}
              </a>
            )}
          </p>
        ))
      )}
    </li>
  );
}

// #67: the band beneath the automatic merge bar, the same shape clustering's review queue
// has one register above — a threshold with a band under it, decided by a person,
// remembered afterwards. Every row is a pair the pass would not fold itself, and until
// somebody decides it the pair stays two Entities in the graph.
//
// Which name survives is not the Admin's to choose here: the pass fixed it on the more
// reported side, so the row states the fold rather than offering an orientation.
export function EntityMergeReviewRegister() {
  const queryClient = useQueryClient();
  const review = useQuery({ queryKey: ["graph", "merge-proposals"], queryFn: getMergeProposals });
  // Only its own queue is refetched, unlike clustering's review: a decision here changes
  // the graph, and nothing on this console states the graph — the run rows above are
  // history, and history does not change because a name was folded after the fact.
  const decide = useMutation({
    mutationFn: ({ proposalId, decision }: { proposalId: string; decision: MergeProposalDecision }) =>
      decideMergeProposal(proposalId, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["graph", "merge-proposals"] }),
  });

  return (
    <DashboardRegister
      heading="Entity merge review"
      folio={review.data ? `${review.data.total} awaiting a decision` : "Candidate merges"}
    >
      {review.isPending && <PendingState>Loading the candidate merges…</PendingState>}
      {review.isError && (
        <RetryableError
          message={review.error.message}
          onRetry={() => void review.refetch()}
          retrying={review.isFetching}
        />
      )}
      {decide.error && <ErrorState>{decide.error.message}</ErrorState>}
      {/* The corpus this queue read, in the words and the register the two reader graph
          surfaces state it in (components/graphRegister). AGENTS.md exempts the graph's
          read seam from the membership join on the condition that every surface drawing it
          says which corpus it read, and a reviewer folding two names is reading the
          firehose rather than the Curated Corpus alone. Above the queue, so it is stated in
          the empty state too — where "nothing is waiting" is a fact about that corpus. */}
      {review.data && <GraphLedger retainedDays={review.data.retainedDays} />}
      {review.data &&
        (review.data.items.length === 0 ? (
          <EmptyState>
            <p>
              No candidate merge is waiting on a decision. A pass holds a pair here when two names are close enough to
              be one thing but not close enough to fold without somebody looking.
            </p>
          </EmptyState>
        ) : (
          <EntryList total={review.data.total}>
            {review.data.items.map((proposal) => {
              const deciding = decide.isPending && decide.variables?.proposalId === proposal.id;
              return (
                <RegisterRow
                  key={proposal.id}
                  // The decision, not the pair: an Entity has no record page of its own
                  // yet, and the two names are stated again below with the reporting
                  // that is the whole of what this rests on.
                  name={`Fold “${proposal.merged.canonicalName}” into “${proposal.survivor.canonicalName}”`}
                  body={
                    <ul className="claim-sides">
                      <ProposalSide role="Kept" side={proposal.survivor} />
                      <ProposalSide role="Folded in" side={proposal.merged} />
                    </ul>
                  }
                  meta={[
                    { term: "Similarity", value: proposal.similarity.toFixed(2) },
                    // The kind both names share, stated once: two names that look
                    // identical are two different things when their kinds differ, and
                    // `Ford` the person is never folded into `Ford` the company.
                    { term: "Kind", value: ENTITY_KIND_LABELS[proposal.kind] },
                  ]}
                  action={
                    <>
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => decide.mutate({ proposalId: proposal.id, decision: "accept" })}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={deciding}
                        onClick={() => decide.mutate({ proposalId: proposal.id, decision: "refuse" })}
                      >
                        Refuse
                      </button>
                    </>
                  }
                />
              );
            })}
          </EntryList>
        ))}
    </DashboardRegister>
  );
}

// The merge picker's reach (#52), which is the list endpoint's own page-size ceiling: an
// operator merges Stories they have just read about, and the picker is ordered by when a
// Story was first seen, so those are the ones it offers.
//
// ponytail: two selects over the most recently opened Stories, so an older pair cannot
// be merged from here. The upgrade path is the Index archetype's filters on the picker,
// or a merge control on Story detail — worth it once someone needs a pair this misses.
const MERGE_PICKER_STORIES = 50;

// #52: the correction the review queue cannot make. A proposal is about one Article;
// this is about two Stories an operator has read and judged to be one event. A command
// form rather than a register of rows, because the thing being acted on is a pair the
// operator chooses — there is no row to hang it on.
export function StoryMergeRegister() {
  const refresh = useConsoleRefresh();
  const queryClient = useQueryClient();
  const [survivorStoryId, setSurvivorStoryId] = useState("");
  const [mergedStoryId, setMergedStoryId] = useState("");
  // Its own request: a list of Stories is not part of the console payload, and it is
  // refetched after a merge because one of the two it offered has stopped existing.
  const storyPicker = useQuery({
    queryKey: ["stories", "merge-picker"],
    queryFn: () => getStories({ pageSize: MERGE_PICKER_STORIES, sort: "firstSeenAt:desc" }),
  });
  // A merge changes the Stories the picker offers, the counts the console states, and
  // any proposal that named the Story that is gone — so all three are refetched. The
  // Story merged away is cleared from the selection because it no longer exists; the
  // survivor stays selected, since it does.
  const merge = useMutation({
    mutationFn: () => mergeStories(survivorStoryId, mergedStoryId),
    onSuccess: () => {
      setMergedStoryId("");
      void queryClient.invalidateQueries({ queryKey: ["stories"] });
      void queryClient.invalidateQueries({ queryKey: ["clustering", "pending"] });
      void refresh();
    },
  });

  return (
    <DashboardRegister
      heading="Story merge"
      folio={storyPicker.data ? `${storyPicker.data.total} Stories` : "Two Stories, one event"}
    >
      {storyPicker.isPending && <PendingState>Loading Stories…</PendingState>}
      {storyPicker.isError && (
        <RetryableError
          message={storyPicker.error.message}
          onRetry={() => void storyPicker.refetch()}
          retrying={storyPicker.isFetching}
        />
      )}
      {merge.error && <ErrorState>{merge.error.message}</ErrorState>}
      {/* Done, not queued — a merge is executed in the request, unlike every other
          command on this console. Same stated-note treatment because it is the same kind
          of line: what the command did, said where it was fired, and announced
          (role="status") for a reader who cannot see the registers around it refresh. */}
      {merge.isSuccess && (
        <PendingState>
          Merged. {merge.data.movedArticles} Article
          {merge.data.movedArticles === 1 ? "" : "s"} moved to the surviving Story, and the emptied Story is gone.
        </PendingState>
      )}
      {storyPicker.data &&
        (storyPicker.data.items.length < 2 ? (
          <EmptyState>
            <p>
              Fewer than two Stories, so there is no pair to merge. Clustering creates Stories from ingested
              reporting.
            </p>
          </EmptyState>
        ) : (
          <form
            className="filter-register"
            aria-label="Merge two Stories"
            onSubmit={(event) => {
              event.preventDefault();
              merge.mutate();
            }}
          >
            {/* The survivor first, in reading order: what is kept, then what is folded
                into it. Both lists are the same Stories — the server refuses the pair
                that names one Story twice, and the button does not offer it. */}
            <label className="filter-field">
              Surviving Story{" "}
              <select value={survivorStoryId} onChange={(e) => setSurvivorStoryId(e.target.value)}>
                <option value="">Choose…</option>
                {storyPicker.data.items.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                  </option>
                ))}
              </select>
            </label>{" "}
            <label className="filter-field">
              Merged into it{" "}
              <select value={mergedStoryId} onChange={(e) => setMergedStoryId(e.target.value)}>
                <option value="">Choose…</option>
                {storyPicker.data.items.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                  </option>
                ))}
              </select>
            </label>{" "}
            <div className="entry-action">
              <button
                type="submit"
                disabled={
                  merge.isPending ||
                  survivorStoryId === "" ||
                  mergedStoryId === "" ||
                  survivorStoryId === mergedStoryId
                }
              >
                {merge.isPending ? "Merging…" : "Merge"}
              </button>
            </div>
          </form>
        ))}
    </DashboardRegister>
  );
}

// #57: what a tuned version asks for, read as an operator reads it — the register's own
// summary of the parameters, so the difference between two versions is visible without
// opening anything. An empty tone or emphasis is stated as the default rather than as a
// blank cell.
function tuningSummary(template: PromptTemplateSummary): string {
  const { tone, lensEmphasis, claimCount, surfacedClaimTypes } = template.params;
  return [
    `${claimCount.min}–${claimCount.max} claims`,
    surfacedClaimTypes.join(", "),
    tone ? `tone: ${tone}` : "no tone set",
    lensEmphasis ? `emphasis: ${lensEmphasis}` : "no Lens emphasis",
  ].join(" · ");
}

// #57: prompt tuning. A register of the versions that exist, and a form that writes a
// new one — a version is created, never edited, so the only command on a row is making
// it current, and there is no way to leave the table with nothing current.
export function PromptVersionsRegister({
  templates,
  claimCountRange,
}: {
  templates: PromptTemplateSummary[];
  claimCountRange: { min: number; max: number };
}) {
  const refresh = useConsoleRefresh();
  // The tuning form's own state. It starts at the shipped defaults rather than at
  // whatever is current, because a version is created, never edited — so this is a new
  // version being written, not a form over an existing row.
  //
  // ponytail: an Admin tuning away from an already-tuned version retypes it. Prefilling
  // from the current row is the upgrade, and it wants the form to live below the query
  // rather than beside it.
  const [version, setVersion] = useState("");
  const [tone, setTone] = useState("");
  const [lensEmphasis, setLensEmphasis] = useState("");
  const [claimMin, setClaimMin] = useState(3);
  const [claimMax, setClaimMax] = useState(6);
  const [surfacedClaimTypes, setSurfacedClaimTypes] = useState<CoreClaimType[]>([...CORE_CLAIM_TYPES]);

  // Creating a version or making one current refetches this register. Prompt
  // configuration affects only the next analysis request.
  const tune = useMutation({
    mutationFn: () =>
      createPromptTemplate({
        version,
        params: { tone, lensEmphasis, claimCount: { min: claimMin, max: claimMax }, surfacedClaimTypes },
      }),
    onSuccess: () => {
      setVersion("");
      void refresh();
    },
  });
  const current = useMutation({ mutationFn: setPromptTemplateCurrent, onSuccess: refresh });
  // Two commands in one register, so firing either clears the other's refusal: a
  // mutation keeps its error until it is reset, and a failed Create would otherwise stay
  // stated above the register through a later successful activation.
  const command = (fire: () => void): void => {
    tune.reset();
    current.reset();
    fire();
  };

  return (
    <DashboardRegister
      heading="Prompt versions"
      folio={templates.find((template) => template.isCurrent)?.version ?? "none current"}
    >
      {(tune.error || current.error) && <ErrorState>{tune.error?.message ?? current.error?.message}</ErrorState>}
      {tune.isSuccess && (
        <PendingState>
          Version {tune.data.version} created. Make it current to serve it — its first matching analysis is generated
          under that version.
        </PendingState>
      )}
      {current.isSuccess && (
        <PendingState>
          Version {current.data.version} is current. Analyses already produced under this exact version may be
          reused; other prompt versions do not match.
        </PendingState>
      )}
      {templates.length === 0 ? (
        <EmptyState>
          <p>
            No prompt versions — run <code>npm run migrate</code> in <code>backend/</code>. The pipeline falls back to
            the shipped prompt until one exists.
          </p>
        </EmptyState>
      ) : (
        <EntryList>
          {templates.map((template) => (
            <RegisterRow
              key={template.id}
              name={template.version}
              note={tuningSummary(template)}
              meta={[
                { term: "Status", value: template.isCurrent ? "Current" : "Retained" },
                { term: "Created", value: new Date(template.createdAt).toLocaleString() },
              ]}
              action={
                // Only a version that is not current carries a command: the current one
                // is superseded by activating another, not switched off (#57).
                template.isCurrent ? undefined : (
                  <button
                    type="button"
                    disabled={current.isPending && current.variables === template.id}
                    onClick={() => command(() => current.mutate(template.id))}
                  >
                    {current.isPending && current.variables === template.id ? "Activating…" : "Make current"}
                  </button>
                )
              }
            />
          ))}
        </EntryList>
      )}

      {/* Tuning is writing a version, so this is a form rather than controls on a row.
          What it cannot offer is the point (ADR-0021): there is no field here for the
          citation check, because that check is not configuration — it is code below the
          prompt, and a claim that fails it is dropped whatever this form says. */}
      <form
        className="filter-register"
        aria-label="Create a prompt version"
        onSubmit={(event) => {
          event.preventDefault();
          command(() => tune.mutate());
        }}
      >
        <label className="filter-field">
          Version label{" "}
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026-10-01-plainer" />
        </label>{" "}
        <label className="filter-field">
          Tone <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="plainer sentences" />
        </label>{" "}
        <label className="filter-field">
          Lens emphasis{" "}
          <input value={lensEmphasis} onChange={(e) => setLensEmphasis(e.target.value)} placeholder="what to weigh" />
        </label>{" "}
        <label className="filter-field">
          Fewest claims{" "}
          <input
            type="number"
            min={claimCountRange.min}
            max={claimCountRange.max}
            value={claimMin}
            onChange={(e) => setClaimMin(Number(e.target.value))}
          />
        </label>{" "}
        <label className="filter-field">
          Most claims{" "}
          <input
            type="number"
            min={claimCountRange.min}
            max={claimCountRange.max}
            value={claimMax}
            onChange={(e) => setClaimMax(Number(e.target.value))}
          />
        </label>{" "}
        {/* A group rather than a fieldset: the pill treatment these controls share is an
            inline-flex row, which a legend does not sit inside. role="group" +
            aria-label carries the same grouping to a screen reader without a second
            layout to maintain. */}
        <div className="filter-field" role="group" aria-label="Claim types surfaced">
          Surfaced{" "}
          {CORE_CLAIM_TYPES.map((claimType) => (
            <label key={claimType}>
              <input
                type="checkbox"
                checked={surfacedClaimTypes.includes(claimType)}
                onChange={(e) =>
                  setSurfacedClaimTypes((held) =>
                    e.target.checked
                      ? // Rebuilt from the canonical order rather than appended to, so
                        // the same three boxes always produce the same list — and
                        // therefore the same prompt.
                        CORE_CLAIM_TYPES.filter((candidate) => candidate === claimType || held.includes(candidate))
                      : held.filter((candidate) => candidate !== claimType),
                  )
                }
              />{" "}
              {claimType}
            </label>
          ))}
        </div>{" "}
        <div className="entry-action">
          <button type="submit" disabled={tune.isPending || version.trim() === ""}>
            {tune.isPending ? "Creating…" : "Create version"}
          </button>
        </div>
      </form>
    </DashboardRegister>
  );
}
