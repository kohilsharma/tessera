import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminDashboard,
  runIngestionConnector,
  setConnectorEnabled,
  USER_ROLES,
  type IngestionRunSummary,
} from "../api/client";
import DashboardShell from "./DashboardShell";
import {
  CountPlates,
  DashboardOnward,
  DashboardPage,
  DashboardRegister,
  RegisterRow,
} from "../components/dashboardArchetype";
import { EmptyState, EntryList, ErrorState } from "../components/uiStates";

// A run's own timing, in the note line rather than the ledger: a timestamp and a
// duration are one fact about when, and two more ledger cells beside seven
// counters would be the widest register on the surface holding the least.
function runTiming(run: IngestionRunSummary): string {
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

// The Admin surface (#36, #39): four operator registers, in three shapes, so they
// are told apart before they are read — standing totals as plates, the connector
// fleet as a status register an operator can act on, ingestion history as a
// ledger of runs, publishers as a coverage register.
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
  const commandError = run.error?.message ?? toggle.error?.message ?? null;

  // Firing either command clears both refusals first: a mutation keeps its error
  // until it is reset, so a failed Run would otherwise stay stated above the
  // register through a later successful Disable, describing something that is no
  // longer true.
  function command(fire: () => void): void {
    run.reset();
    toggle.reset();
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
                              operator running one feed has not lost the others.
                              A disabled connector is refused server-side, so the
                              button is not offered at all. */}
                          <button
                            type="button"
                            disabled={!connector.enabled || (run.isPending && run.variables === connector.id)}
                            onClick={() => command(() => run.mutate(connector.id))}
                          >
                            {run.isPending && run.variables === connector.id ? "Running…" : "Run"}
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
                populated whether or not the worker is running. */}
            <DashboardRegister
              heading="Ingestion runs"
              folio={`${data.ingestionRuns.length} most recent`}
            >
              {data.ingestionRuns.length === 0 ? (
                <EmptyState>
                  <p>No connector has run yet — press Run on a connector above.</p>
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
