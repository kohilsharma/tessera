import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getAdminDashboard, USER_ROLES } from "../api/client";
import DashboardShell from "./DashboardShell";

export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <main>
          <h1>Admin dashboard</h1>

          <h2>Users</h2>
          <dl>
            {/* Rows come from the role list, so a fourth role needs no edit here. */}
            {USER_ROLES.map((role) => (
              <div key={role}>
                <dt>{role}</dt>
                <dd>{data.userCounts[role]}</dd>
              </div>
            ))}
          </dl>

          {/* Connectors are seed-only in Phase 1 (ADR-0022): the operator
              inspects them here; ingestion starts reading them in Phase 2. */}
          <h2>Ingestion connectors</h2>
          {data.connectors.length === 0 ? (
            <p>
              No connectors — run <code>npm run seed</code> in <code>backend/</code>.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.connectors.map((connector) => (
                  <tr key={connector.id}>
                    <th scope="row">{connector.name}</th>
                    <td>{connector.kind}</td>
                    <td>
                      <code>{connector.endpoint}</code>
                    </td>
                    <td>{connector.enabled ? "enabled" : "disabled"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Publishers</h2>
          {data.publishers.length === 0 ? (
            <p>
              No publishers — run <code>npm run seed</code> in <code>backend/</code>.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Articles</th>
                </tr>
              </thead>
              <tbody>
                {data.publishers.map((publisher) => (
                  <tr key={publisher.id}>
                    <th scope="row">{publisher.name}</th>
                    <td>
                      <code>{publisher.domain}</code>
                    </td>
                    <td>{publisher.articleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p>
            <Link to="/stories">Browse Stories</Link> · <Link to="/search">Search</Link>
          </p>
        </main>
      )}
    </DashboardShell>
  );
}
