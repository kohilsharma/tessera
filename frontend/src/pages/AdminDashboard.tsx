import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminDashboard,
  runClustering,
  runIngestionConnector,
  setConnectorEnabled,
  USER_ROLES,
  type ClusteringRunSummary,
  type IngestionRunSummary,
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
import { EmptyState, EntryList, ErrorState, PendingState } from "../components/uiStates";

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

// The Admin surface (#36, #39, #49): five operator registers, in three shapes, so
// they are told apart before they are read — standing totals as plates, the
// connector fleet as a status register an operator can act on, ingestion and
// clustering history as ledgers of runs, publishers as a coverage register.
export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });
  const queryClient = useQueryClient();

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
  const commandError = run.error?.message ?? toggle.error?.message ?? null;

  // Firing any command clears the others' refusals first: a mutation keeps its
  // error until it is reset, so a failed Run would otherwise stay stated above the
  // register through a later successful Disable, describing something that is no
  // longer true.
  function command(fire: () => void): void {
    run.reset();
    toggle.reset();
    cluster.reset();
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
                        { term: "Seeded", value: clusteringRun.seeded },
                        { term: "New Stories", value: clusteringRun.storiesCreated },
                        { term: "Unclustered", value: clusteringRun.unclustered },
                      ]}
                    />
                  ))}
                </EntryList>
              )}
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
