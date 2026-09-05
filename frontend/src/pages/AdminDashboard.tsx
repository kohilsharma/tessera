import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createIngestionConnector,
  deleteIngestionConnector,
  getAdminDashboard,
  runIngestionConnector,
  setConnectorEnabled,
  updateIngestionConnector,
  USER_ROLES,
  type ConnectorKind,
  type ConnectorSummary,
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
import { EmptyState, EntryList, ErrorState, NoticeState, PendingState } from "../components/uiStates";
import { Field } from "../components/formArchetype";
import { AlertDialog } from "@base-ui-components/react/alert-dialog";
import { Link } from "react-router-dom";
import { Leaning, LeaningAttribution } from "../components/primitives";
import {
  ClusteringReviewRegister,
  ClusteringRunsRegister,
  EntityMergeReviewRegister,
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

// Mirrors CONNECTOR_KINDS in backend/src/entities/IngestionConnector.ts. Named
// the way CONTEXT.md and ADR-0018 name the four ingestion surfaces, because
// `gdelt_gkg` is a column value rather than something an operator says.
const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  gdelt_gkg: "GDELT GKG firehose",
  gdelt_doc: "GDELT DOC API",
  rss: "RSS feed",
  readability: "Readability extraction",
};
const CONNECTOR_KINDS = Object.keys(CONNECTOR_KIND_LABEL) as ConnectorKind[];
type ConnectorDraft = { id?: string; name: string; kind: ConnectorKind; endpoint: string; feedProvidesFullText: boolean | null };

function connectorDraft(connector?: ConnectorSummary): ConnectorDraft {
  return {
    id: connector?.id,
    name: connector?.name ?? "",
    kind: connector?.kind ?? "rss",
    endpoint: connector?.endpoint ?? "",
    feedProvidesFullText: connector?.feedProvidesFullText ?? false,
  };
}

function ConnectorEditor({
  draft,
  pending,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: ConnectorDraft;
  pending: boolean;
  error: string | null;
  onChange: (next: ConnectorDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  // `Field` rather than a hand-rolled label-and-input: it is what every other form
  // on the product draws, and it wires aria-invalid and aria-describedby to the
  // one line under the control, which a copy of the markup silently drops.
  return (
    <form className="form-panel" aria-label={draft.id ? "Edit connector" : "Create connector"} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {error && <ErrorState>{error}</ErrorState>}
      <Field id="connector-name" label="Name" hint="How this connector is listed here. Two connectors cannot share one.">
        {(field) => <input {...field} value={draft.name} disabled={pending} onChange={(event) => onChange({ ...draft, name: event.target.value })} required />}
      </Field>
      <Field id="connector-kind" label="Kind" hint="Which ingestion surface this connector reads (ADR-0018).">
        {(field) => (
          <select {...field} value={draft.kind} disabled={pending} onChange={(event) => onChange({ ...draft, kind: event.target.value as ConnectorKind })}>
            {CONNECTOR_KINDS.map((kind) => <option key={kind} value={kind}>{CONNECTOR_KIND_LABEL[kind]}</option>)}
          </select>
        )}
      </Field>
      <Field
        id="connector-endpoint"
        label="Endpoint"
        hint={draft.kind === "readability" ? "Readability discovers nothing, so this names the pass rather than an address." : "The address this connector reads."}
      >
        {(field) => <input {...field} value={draft.endpoint} disabled={pending} onChange={(event) => onChange({ ...draft, endpoint: event.target.value })} required />}
      </Field>
      {/* Only RSS carries a feed policy; the column is null for every other kind,
          so the control exists exactly where the value is meaningful. */}
      {draft.kind === "rss" && (
        <label className="filter-field">
          <input type="checkbox" checked={draft.feedProvidesFullText === true} disabled={pending} onChange={(event) => onChange({ ...draft, feedProvidesFullText: event.target.checked })} />
          Feed supplies full text
        </label>
      )}
      <div className="record-actions">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : draft.id ? "Save connector" : "Create connector"}</button>
        <button type="button" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// Deleting a connector is the only command on this console with no undo, so it
// interrupts and holds focus (Base UI, per DESIGN.md §9) rather than riding on
// the browser's confirm(), which cannot say what survives in more than one line.
function ConfirmConnectorDelete({
  connector,
  pending,
  onCancel,
  onConfirm,
}: {
  connector: ConnectorSummary | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={connector !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="confirm-backdrop" />
        <AlertDialog.Popup className="confirm-popup">
          <AlertDialog.Title render={<h2 />}>Delete {connector?.name}?</AlertDialog.Title>
          <AlertDialog.Description render={<p />}>
            Its configuration is removed and it stops being scheduled.
          </AlertDialog.Description>
          {/* The ticket's own requirement: say what happens to the runs instead of
              cascading quietly. Both halves are stated before the press, not after. */}
          <p className="confirm-consequence">
            Its ingestion run history is kept and stays readable under this name, and the Articles it
            discovered remain in the corpus.
          </p>
          <div className="confirm-actions">
            <button type="button" className="confirm-destroy" disabled={pending} onClick={onConfirm}>
              {pending ? "Deleting…" : "Delete connector"}
            </button>
            <button type="button" disabled={pending} onClick={onCancel}>Keep it</button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The Admin surface (#36, #39, #49, #50, #52, #57, #66, #67): ten operator registers, in
// four shapes, so they are told apart before they are read — standing totals as plates,
// the connector fleet and the two review queues as registers an operator acts on,
// ingestion, clustering and resolution history as ledgers of runs, the Story merge and
// prompt tuning as command forms, publishers as a coverage register.
//
// This page lays them out and owns the two that read the console payload it fetches;
// the six Phase-3 registers own their own requests and commands (./adminRegisters).
export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<ConnectorDraft | null>(null);
  // The outcome carries whether it was a deletion rather than being recovered by
  // reading the server's sentence: the message is prose the API owns and may
  // reword, and a rendering decision should not depend on its first two words.
  const [connectorNotice, setConnectorNotice] = useState<{ text: string; runsRetained: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConnectorSummary | null>(null);

  // Both mutations change what this same payload says, so both refetch it — the
  // run counts, the new IngestionRun, and the publishers it may have created all
  // arrive together rather than as three separate reconciliations.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
  const run = useMutation({ mutationFn: runIngestionConnector, onSuccess: invalidate });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setConnectorEnabled(id, enabled),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: createIngestionConnector,
    onSuccess: (connector) => { invalidate(); setEditor(null); setConnectorNotice({ text: `${connector.name} created.`, runsRetained: 0 }); },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConnectorDraft }) => updateIngestionConnector(id, input),
    onSuccess: (connector) => { invalidate(); setEditor(null); setConnectorNotice({ text: `${connector.name} updated.`, runsRetained: 0 }); },
  });
  const remove = useMutation({
    mutationFn: deleteIngestionConnector,
    onSuccess: (result) => { invalidate(); setPendingDelete(null); setConnectorNotice({ text: result.message, runsRetained: result.runsRetained }); },
  });
  const commandError = run.error?.message ?? toggle.error?.message ?? create.error?.message ?? update.error?.message ?? remove.error?.message ?? null;

  // Firing either connector command clears the other's refusal first: a mutation keeps
  // its error until it is reset, so a failed Run would otherwise stay stated above the
  // register through a later successful Disable, describing something that is no longer
  // true. Each register below resets only its own, for the same reason.
  function command(fire: () => void): void {
    run.reset();
    toggle.reset();
    create.reset();
    update.reset();
    remove.reset();
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
            <DashboardRegister heading="Accounts" folio={`${USER_ROLES.length} roles`} command={<Link className="index-action" to="/admin/users">Manage users</Link>}>
              {/* Plates come from the role list, so a fourth role needs no edit here. */}
              <CountPlates
                counts={USER_ROLES.map((role) => ({ term: role, value: data.userCounts[role] }))}
              />
            </DashboardRegister>

            <DashboardRegister
              heading="Ingestion connectors"
              folio={`${data.connectors.filter((connector) => connector.enabled).length} of ${data.connectors.length} enabled`}
              command={<button type="button" onClick={() => { setConnectorNotice(null); setEditor(connectorDraft()); }}>Add connector</button>}
            >
              {connectorNotice && <NoticeState>{connectorNotice.text}</NoticeState>}
              {editor && (
                <ConnectorEditor
                  draft={editor}
                  pending={create.isPending || update.isPending}
                  error={create.error?.message ?? update.error?.message ?? null}
                  onChange={setEditor}
                  onCancel={() => { create.reset(); update.reset(); setEditor(null); }}
                  onSubmit={() => {
                    setConnectorNotice(null);
                    if (editor.id) {
                      const { id, ...input } = editor;
                      update.mutate({ id, input });
                    }
                    else create.mutate(editor);
                  }}
                />
              )}
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
                        { term: "Kind", value: CONNECTOR_KIND_LABEL[connector.kind] },
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
                          <button type="button" disabled={remove.isPending && remove.variables === connector.id} onClick={() => { setConnectorNotice(null); setEditor(connectorDraft(connector)); }}>
                            Edit
                          </button>
                          <button type="button" disabled={remove.isPending && remove.variables === connector.id} onClick={() => {
                            setConnectorNotice(null);
                            command(() => setPendingDelete(connector));
                          }}>
                            Delete
                          </button>
                        </>
                      }
                    />
                  ))}
                </EntryList>
              )}
              {/* Only when there is history to have kept: a connector that never ran
                  has none, and saying otherwise would be the same kind of guess the
                  outcome message exists to remove. */}
              {(connectorNotice?.runsRetained ?? 0) > 0 && (
                <p className="record-prose">Its run history stays in the ledger below, under the name it had.</p>
              )}
              <ConfirmConnectorDelete
                connector={pendingDelete}
                pending={remove.isPending}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
              />
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

            {/* Beside clustering's review rather than under resolution's ledger: the two
                queues are the same job at two scales — a band beneath a threshold that
                only a person can decide — and an operator works them together. */}
            <EntityMergeReviewRegister />

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
                        // #85: the second classification axis, and the first that
                        // is somebody else's judgement rather than ours. Beside
                        // Terms because an operator reads both as facts about the
                        // source, not as anything Tessera concluded about it.
                        { term: "Leaning", value: <Leaning leaning={publisher.leaning} /> },
                        { term: "Articles", value: publisher.articleCount },
                      ]}
                    />
                  ))}
                </EntryList>
              )}
              {/* One credit for the whole register rather than one per row: every
                  rating here is a cited claim, and the licence asks for the rater
                  named where the ratings are. Renders nothing when no row on this
                  page carried a rating (ADR-0035). */}
              <LeaningAttribution
                sources={data.publishers.flatMap((publisher) => (publisher.leaning ? [publisher.leaning.source] : []))}
              />
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
