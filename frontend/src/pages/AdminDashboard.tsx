import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminDashboard,
  runIngestionConnector,
  setConnectorEnabled,
  USER_ROLES,
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
import {
  ClusteringReviewRegister,
  ClusteringRunsRegister,
  EntityResolutionRunsRegister,
  PromptVersionsRegister,
  RUN_STATUS_LABEL,
  StoryMergeRegister,
  runTiming,
} from "./adminRegisters";

// A Terms Class read as an operator reads it: what this publisher's text is
// cleared for, not the enum spelling (#40).
const TERMS_CLASS_LABEL: Record<TermsClass, string> = {
  open_metadata: "Metadata only",
  syndicated_excerpt: "Excerpt cleared",
  internal_only: "Internal only",
  licensed: "Licensed",
};

// The Admin surface (#36, #39, #49, #50, #52, #57): eight operator registers, in four
// shapes, so they are told apart before they are read — standing totals as plates,
// the connector fleet and the clustering review queue as registers an operator acts
// on, ingestion and clustering history as ledgers of runs, the Story merge and prompt
// tuning as command forms, publishers as a coverage register.
//
// This page lays them out and owns the two that read the console payload it fetches;
// the five Phase-3 registers own their own requests and commands (./adminRegisters).
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

  // Firing either connector command clears the other's refusal first: a mutation keeps
  // its error until it is reset, so a failed Run would otherwise stay stated above the
  // register through a later successful Disable, describing something that is no longer
  // true. Each register below resets only its own, for the same reason.
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

            <ClusteringRunsRegister runs={data.clusteringRuns} />

            {/* The three pipeline ledgers read in the order the pipeline runs, and
                before the registers that ask an operator to decide something. */}
            <EntityResolutionRunsRegister runs={data.entityResolutionRuns} />

            <ClusteringReviewRegister />

            <StoryMergeRegister />

            <PromptVersionsRegister
              templates={data.promptTemplates}
              claimCountRange={data.promptClaimCountRange}
            />

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
