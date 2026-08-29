import { useQuery } from "@tanstack/react-query";
import { getAdminDashboard, USER_ROLES } from "../api/client";
import DashboardShell from "./DashboardShell";
import {
  CountPlates,
  DashboardOnward,
  DashboardPage,
  DashboardRegister,
  RegisterRow,
} from "../components/dashboardArchetype";
import { EmptyState, EntryList } from "../components/uiStates";

// The Admin surface (#36): three operator registers, in three shapes, so the
// three are told apart before they are read — standing totals as plates, the
// connector fleet as a status register, publishers as a coverage register.
export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });

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
            dek="Accounts, ingestion connectors, and the publishers behind the corpus."
          >
            <DashboardRegister heading="Accounts" folio={`${USER_ROLES.length} roles`}>
              {/* Plates come from the role list, so a fourth role needs no edit here. */}
              <CountPlates
                counts={USER_ROLES.map((role) => ({ term: role, value: data.userCounts[role] }))}
              />
            </DashboardRegister>

            {/* Connectors are seed-only in Phase 1 (ADR-0022): the operator
                inspects them here; ingestion starts reading them in Phase 2. */}
            <DashboardRegister
              heading="Ingestion connectors"
              folio={`${data.connectors.filter((connector) => connector.enabled).length} of ${data.connectors.length} enabled`}
            >
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
