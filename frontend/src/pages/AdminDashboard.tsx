import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  decidePendingAssignment,
  createPromptTemplate,
  getAdminDashboard,
  getPendingAssignments,
  getStories,
  setPromptTemplateCurrent,
  mergeStories,
  runClustering,
  runIngestionConnector,
  setConnectorEnabled,
  CORE_CLAIM_TYPES,
  USER_ROLES,
  type AssignmentDecision,
  type ClusteringRunSummary,
  type IngestionRunSummary,
  type PromptTemplateSummary,
  type CoreClaimType,
  type TermsClass,
} from "../api/client";
import DashboardShell from "./DashboardShell";
import {
  CountPlates,
  DashboardOnward,
  DashboardPage,
  DashboardRegister,
  RegisterRow,
} from "../components/dashboardArchetype";
import { EmptyState, EntryList, ErrorState, PendingState, RetryableError } from "../components/uiStates";

// A run's own timing, in the note line rather than the ledger: a timestamp and a
// duration are one fact about when, and two more ledger cells beside seven
// counters would be the widest register on the surface holding the least.
function runTiming(run: IngestionRunSummary | ClusteringRunSummary): string {
  const started = new Date(run.startedAt);
  if (!run.completedAt) return `${started.toLocaleString()} · in flight`;
  const seconds = (new Date(run.completedAt).getTime() - started.getTime()) / 1000;
  return `${started.toLocaleString()} · ${seconds.toFixed(1)}s`;
}

const RUN_STATUS_LABEL: Record<IngestionRunSummary["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

// A Terms Class read as an operator reads it: what this publisher's text is
// cleared for, not the enum spelling (#40).
const TERMS_CLASS_LABEL: Record<TermsClass, string> = {
  open_metadata: "Metadata only",
  syndicated_excerpt: "Excerpt cleared",
  internal_only: "Internal only",
  licensed: "Licensed",
};

// The merge picker's reach (#52), which is the list endpoint's own page-size ceiling:
// an operator merges Stories they have just read about, and the picker is ordered by
// when a Story was first seen, so those are the ones it offers.
//
// ponytail: two selects over the most recently opened Stories, so an older pair
// cannot be merged from here. The upgrade path is the Index archetype's filters on the
// picker, or a merge control on Story detail — worth it once someone needs a pair this
// misses.
const MERGE_PICKER_STORIES = 50;

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

// The Admin surface (#36, #39, #49, #50, #52, #57): eight operator registers, in four
// shapes, so they are told apart before they are read — standing totals as plates,
// the connector fleet and the clustering review queue as registers an operator acts
// on, ingestion and clustering history as ledgers of runs, the Story merge and prompt
// tuning as command forms, publishers as a coverage register.
export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });
  // The review queue is its own request, unlike every other register here: it is a
  // page of a queue that grows with the corpus rather than a fixed panel of the
  // console, and it is refetched on its own after each decision. So it carries its
  // own four UI states inside the register, where the rest share the page's.
  const review = useQuery({ queryKey: ["clustering", "pending"], queryFn: getPendingAssignments });
  // The merge picker's own request, for the same reason: a list of Stories is not
  // part of the console payload, and it is refetched after a merge because one of
  // the two it offered has stopped existing.
  const storyPicker = useQuery({
    queryKey: ["stories", "merge-picker"],
    queryFn: () => getStories({ pageSize: MERGE_PICKER_STORIES, sort: "firstSeenAt:desc" }),
  });
  const queryClient = useQueryClient();
  const [survivorStoryId, setSurvivorStoryId] = useState("");
  const [mergedStoryId, setMergedStoryId] = useState("");
  // #57: the tuning form's own state. It starts at the shipped defaults rather than at
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
  const [surfacedClaimTypes, setSurfacedClaimTypes] = useState<CoreClaimType[]>([
    ...CORE_CLAIM_TYPES,
  ]);

  // Both mutations change what this same payload says, so both refetch it — the
  // run counts, the new IngestionRun, and the publishers it may have created all
  // arrive together rather than as three separate reconciliations.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
  const run = useMutation({ mutationFn: runIngestionConnector, onSuccess: invalidate });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setConnectorEnabled(id, enabled),
    onSuccess: invalidate,
  });
  // Clustering is the same enqueue-and-wait shape as a connector run, and it too
  // changes Stories, Articles and the run history this payload carries.
  const cluster = useMutation({ mutationFn: runClustering, onSuccess: invalidate });
  // A decision changes the queue *and* the console: accepting adds a member to a
  // Story, which moves the publisher and Story counts the other registers state.
  const decide = useMutation({
    mutationFn: ({ articleId, decision }: { articleId: string; decision: AssignmentDecision }) =>
      decidePendingAssignment(articleId, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clustering", "pending"] });
      invalidate();
    },
  });
  const commandError = run.error?.message ?? toggle.error?.message ?? null;

  // #52: a merge changes the Stories the picker offers, the counts the console
  // states, and any proposal that named the Story that is gone — so all three are
  // refetched. The Story merged away is cleared from the picker's selection because
  // it no longer exists; the survivor stays selected, since it does.
  const merge = useMutation({
    mutationFn: () => mergeStories(survivorStoryId, mergedStoryId),
    onSuccess: () => {
      setMergedStoryId("");
      void queryClient.invalidateQueries({ queryKey: ["stories"] });
      void queryClient.invalidateQueries({ queryKey: ["clustering", "pending"] });
      invalidate();
    },
  });

  // #57: creating a version or changing current status refetches this register.
  // Prompt configuration affects only the next analysis request.
  const tune = useMutation({
    mutationFn: () =>
      createPromptTemplate({
        version,
        params: { tone, lensEmphasis, claimCount: { min: claimMin, max: claimMax }, surfacedClaimTypes },
      }),
    onSuccess: () => {
      setVersion("");
      invalidate();
    },
  });
  const current = useMutation({
    mutationFn: ({ id, isCurrent }: { id: string; isCurrent: boolean }) => setPromptTemplateCurrent(id, isCurrent),
    onSuccess: invalidate,
  });

  // Firing any command clears the others' refusals first: a mutation keeps its
  // error until it is reset, so a failed Run would otherwise stay stated above the
  // register through a later successful Disable, describing something that is no
  // longer true.
  function command(fire: () => void): void {
    run.reset();
    toggle.reset();
    cluster.reset();
    decide.reset();
    merge.reset();
    tune.reset();
    current.reset();
    fire();
  }

  return (
    <DashboardShell query={query}>
      {(data) => {
        // As on the Investor rollup: relative to the widest-covered publisher,
        // guarded so an unseeded corpus divides by something.
        const widest = Math.max(1, ...data.publishers.map((publisher) => publisher.articleCount));

        return (
          <DashboardPage
            role="admin"
            folio="Admin dashboard"
            title="Operator console"
            dek="Accounts, ingestion connectors and their run history, and the publishers behind the corpus."
          >
            <DashboardRegister heading="Accounts" folio={`${USER_ROLES.length} roles`}>
              {/* Plates come from the role list, so a fourth role needs no edit here. */}
              <CountPlates
                counts={USER_ROLES.map((role) => ({ term: role, value: data.userCounts[role] }))}
              />
            </DashboardRegister>

            <DashboardRegister
              heading="Ingestion connectors"
              folio={`${data.connectors.filter((connector) => connector.enabled).length} of ${data.connectors.length} enabled`}
            >
              {/* A refused command is this register's failure, not the page's:
                  the payload loaded fine, so DashboardShell's error treatment
                  would be a lie. Same treatment, stated where it happened. */}
              {commandError && <ErrorState>{commandError}</ErrorState>}
              {/* #42: Run enqueues, so an accepted command has produced nothing
                  to look at yet — and with the worker stopped, which is most of
                  the time, it will not. Saying so is the difference between a
                  queued run and a button that did nothing. The pending treatment
                  because that is exactly what it is: a run that has not happened. */}
              {run.isSuccess && (
                <PendingState>
                  Run queued. Runs appear under Ingestion runs once the worker has executed them — start it with{" "}
                  <code>npm run worker</code> in <code>backend/</code>.
                </PendingState>
              )}
              {data.connectors.length === 0 ? (
                <EmptyState>
                  <p>
                    No connectors — run <code>npm run seed</code> in <code>backend/</code>.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.connectors.map((connector) => (
                    <RegisterRow
                      key={connector.id}
                      name={connector.name}
                      note={connector.endpoint}
                      meta={[
                        { term: "Kind", value: connector.kind },
                        { term: "Status", value: connector.enabled ? "Enabled" : "Disabled" },
                      ]}
                      action={
                        <>
                          {/* Only this row's button reports in flight: an
                              operator queueing one feed has not lost the others.
                              A disabled connector is refused server-side, so the
                              button is not offered at all. */}
                          <button
                            type="button"
                            disabled={!connector.enabled || (run.isPending && run.variables === connector.id)}
                            onClick={() => command(() => run.mutate(connector.id))}
                          >
                            {run.isPending && run.variables === connector.id ? "Queueing…" : "Run"}
                          </button>
                          <button
                            type="button"
                            disabled={toggle.isPending && toggle.variables?.id === connector.id}
                            onClick={() => command(() => toggle.mutate({ id: connector.id, enabled: !connector.enabled }))}
                          >
                            {connector.enabled ? "Disable" : "Enable"}
                          </button>
                        </>
                      }
                    />
                  ))}
                </EntryList>
              )}
            </DashboardRegister>

            {/* ADR-0024: read from Postgres, not the queue — so this register is
                populated whether or not the worker is running, and a run queued
                a moment ago is simply not here yet. */}
            <DashboardRegister
              heading="Ingestion runs"
              folio={`${data.ingestionRuns.length} most recent`}
            >
              {data.ingestionRuns.length === 0 ? (
                <EmptyState>
                  <p>
                    No connector has run yet. The worker runs every enabled connector on the quarter hour; press Run
                    above to queue one now.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.ingestionRuns.map((ingestionRun) => (
                    <RegisterRow
                      key={ingestionRun.id}
                      name={ingestionRun.connectorName}
                      // The error summary rides the note line so a failed run is
                      // diagnosable here rather than in the server log (story 10).
                      note={`${runTiming(ingestionRun)}${ingestionRun.errorSummary ? ` · ${ingestionRun.errorSummary}` : ""}`}
                      meta={[
                        { term: "Status", value: RUN_STATUS_LABEL[ingestionRun.status] },
                        { term: "Discovered", value: ingestionRun.discovered },
                        { term: "Inserted", value: ingestionRun.inserted },
                        { term: "Enriched", value: ingestionRun.enriched },
                        { term: "Duplicate", value: ingestionRun.duplicate },
                        { term: "Rejected", value: ingestionRun.rejectedByPolicy },
                        { term: "Failed", value: ingestionRun.failed },
                      ]}
                    />
                  ))}
                </EntryList>
              )}
            </DashboardRegister>

            {/* #49: the clustering pass, which turns Unclustered Articles into
                Stories. Its command sits on the register rather than on a row,
                because there is one pass over the whole corpus and nothing to name.
                ADR-0026: history is read from Postgres, so this register renders
                whether or not the worker is running. */}
            <DashboardRegister
              heading="Clustering runs"
              folio={`${data.clusteringRuns.length} most recent`}
              command={
                <button type="button" disabled={cluster.isPending} onClick={() => command(() => cluster.mutate())}>
                  {cluster.isPending ? "Queueing…" : "Run clustering"}
                </button>
              }
            >
              {cluster.error && <ErrorState>{cluster.error.message}</ErrorState>}
              {cluster.isSuccess && (
                <PendingState>
                  Clustering queued. The pass runs hourly; a queued run appears below once the worker has executed it —
                  start it with <code>npm run worker</code> in <code>backend/</code>.
                </PendingState>
              )}
              {data.clusteringRuns.length === 0 ? (
                <EmptyState>
                  <p>
                    Clustering has not run yet. Until it does, ingested reporting stays Unclustered — held, but invisible
                    to browse and search.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.clusteringRuns.map((clusteringRun) => (
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

            {/* #50: the band beneath the auto-accept threshold, as a queue rather
                than a ledger — every row is a decision only a person can make, and
                until they make it the Article is invisible to every reader. Its own
                request, so it states its own loading, refusal, empty and populated
                treatments inside the register. */}
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
                      Nothing is waiting on a decision. Clustering holds an Article here when its best Story is a close
                      call rather than a clear match.
                    </p>
                  </EmptyState>
                ) : (
                  <EntryList>
                    {review.data.items.map((proposal) => {
                      const deciding = decide.isPending && decide.variables?.articleId === proposal.id;
                      return (
                        <RegisterRow
                          key={proposal.id}
                          // Not a link, unlike a Story row: a pending Article has no
                          // record page — the API refuses it for the same reason this
                          // queue exists. Its publisher and date are the row's own
                          // address instead.
                          name={proposal.title}
                          note={`${proposal.publisher.name} · ${new Date(proposal.publishedAt).toLocaleString()}`}
                          meta={[
                            { term: "Score", value: proposal.score?.toFixed(2) ?? "unscored" },
                            {
                              term: "Proposed Story",
                              // The Story *is* readable — it has accepted members —
                              // so a reviewer can open what the proposal claims this
                              // reporting belongs to before deciding.
                              value: <Link to={`/stories/${proposal.proposedStory.id}`}>{proposal.proposedStory.title}</Link>,
                            },
                            { term: "Category", value: proposal.proposedStory.category },
                          ]}
                          action={
                            <>
                              <button
                                type="button"
                                disabled={deciding}
                                onClick={() =>
                                  command(() => decide.mutate({ articleId: proposal.id, decision: "accept" }))
                                }
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                disabled={deciding}
                                onClick={() =>
                                  command(() => decide.mutate({ articleId: proposal.id, decision: "reject" }))
                                }
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

            {/* #52: the correction the review queue cannot make. A proposal is about
                one Article; this is about two Stories an operator has read and judged
                to be one event. A command form rather than a register of rows,
                because the thing being acted on is a pair the operator chooses —
                there is no row to hang it on. */}
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
              {/* Done, not queued — a merge is executed in the request, unlike every
                  other command on this console. Same stated-note treatment because it
                  is the same kind of line: what the command did, said where it was
                  fired, and announced (role="status") for a reader who cannot see the
                  registers around it refresh. */}
              {merge.isSuccess && (
                <PendingState>
                  Merged. {merge.data.movedArticles} Article
                  {merge.data.movedArticles === 1 ? "" : "s"} moved to the surviving Story, and the emptied Story is
                  gone.
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
                      command(() => merge.mutate());
                    }}
                  >
                    {/* The survivor first, in reading order: what is kept, then what
                        is folded into it. Both lists are the same Stories — the
                        server refuses the pair that names one Story twice, and the
                        button does not offer it. */}
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

            <DashboardRegister
              heading="Prompt versions"
              folio={
                data.promptTemplates.find((template) => template.isCurrent)?.version ?? "none current"
              }
            >
              {(tune.error || current.error) && (
                <ErrorState>{tune.error?.message ?? current.error?.message}</ErrorState>
              )}
              {tune.isSuccess && (
                <PendingState>
                  Version {tune.data.version} created. Make it current to serve it — its first matching analysis
                  is generated under that version.
                </PendingState>
              )}
              {current.isSuccess && (
                <PendingState>
                  {current.data.isCurrent ? (
                    <>
                      Version {current.data.version} is current. Analyses already produced under this exact version
                      may be reused; other prompt versions do not match.
                    </>
                  ) : (
                    <>
                      Version {current.data.version} is retained, not current. If no other version is current,
                      generation uses the shipped prompt.
                    </>
                  )}
                </PendingState>
              )}
              {data.promptTemplates.length === 0 ? (
                <EmptyState>
                  <p>
                    No prompt versions — run <code>npm run migrate</code> in <code>backend/</code>. The pipeline
                    falls back to the shipped prompt until one exists.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.promptTemplates.map((template) => (
                    <RegisterRow
                      key={template.id}
                      name={template.version}
                      note={tuningSummary(template)}
                      meta={[
                        { term: "Status", value: template.isCurrent ? "Current" : "Retained" },
                        { term: "Created", value: new Date(template.createdAt).toLocaleString() },
                      ]}
                      action={
                        <button
                          type="button"
                          disabled={current.isPending && current.variables?.id === template.id}
                          onClick={() =>
                            command(() => current.mutate({ id: template.id, isCurrent: !template.isCurrent }))
                          }
                        >
                          {current.isPending && current.variables?.id === template.id
                            ? template.isCurrent
                              ? "Deactivating…"
                              : "Activating…"
                            : template.isCurrent
                              ? "Deactivate"
                              : "Make current"}
                        </button>
                      }
                    />
                  ))}
                </EntryList>
              )}

              {/* Tuning is writing a version, so this is a form rather than controls on
                  a row. What it cannot offer is the point (ADR-0021): there is no field
                  here for the citation check, because that check is not configuration —
                  it is code below the prompt, and a claim that fails it is dropped
                  whatever this form says. */}
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
                  <input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="2026-10-01-plainer"
                  />
                </label>{" "}
                <label className="filter-field">
                  Tone{" "}
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    placeholder="plainer sentences"
                  />
                </label>{" "}
                <label className="filter-field">
                  Lens emphasis{" "}
                  <input
                    value={lensEmphasis}
                    onChange={(e) => setLensEmphasis(e.target.value)}
                    placeholder="what to weigh"
                  />
                </label>{" "}
                <label className="filter-field">
                  Fewest claims{" "}
                  <input
                    type="number"
                    min={data.promptClaimCountRange.min}
                    max={data.promptClaimCountRange.max}
                    value={claimMin}
                    onChange={(e) => setClaimMin(Number(e.target.value))}
                  />
                </label>{" "}
                <label className="filter-field">
                  Most claims{" "}
                  <input
                    type="number"
                    min={data.promptClaimCountRange.min}
                    max={data.promptClaimCountRange.max}
                    value={claimMax}
                    onChange={(e) => setClaimMax(Number(e.target.value))}
                  />
                </label>{" "}
                {/* A group rather than a fieldset: the pill treatment these controls
                    share is an inline-flex row, which a legend does not sit inside.
                    role="group" + aria-label carries the same grouping to a screen
                    reader without a second layout to maintain. */}
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
                              ? // Rebuilt from the canonical order rather than appended
                                // to, so the same three boxes always produce the same
                                // list — and therefore the same prompt.
                                CORE_CLAIM_TYPES.filter(
                                  (candidate) => candidate === claimType || held.includes(candidate),
                                )
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

            <DashboardRegister heading="Publishers" folio={`${data.publishers.length} registered`}>
              {data.publishers.length === 0 ? (
                <EmptyState>
                  <p>
                    No publishers — run <code>npm run seed</code> in <code>backend/</code>.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.publishers.map((publisher) => (
                    <RegisterRow
                      key={publisher.id}
                      name={publisher.name}
                      measure={publisher.articleCount / widest}
                      meta={[
                        { term: "Domain", value: <code>{publisher.domain}</code> },
                        { term: "Terms", value: TERMS_CLASS_LABEL[publisher.termsClass] },
                        { term: "Articles", value: publisher.articleCount },
                      ]}
                    />
                  ))}
                </EntryList>
              )}
            </DashboardRegister>

            <DashboardOnward
              links={[
                { to: "/stories", label: "Browse Stories" },
                { to: "/search", label: "Search the corpus" },
              ]}
            />
          </DashboardPage>
        );
      }}
    </DashboardShell>
  );
}
